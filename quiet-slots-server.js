const express = require('express');
const axios = require('axios');

const app = express();
const PORT = 3001;
const FLIGHT_API_URL = 'http://192.168.1.63:3000/flights';

function parseDateTime(flight) {
  try {
    return new Date(`${flight.date}T${flight.heure}:00`);
  } catch {
    return null;
  }
}

function isValidFlight(flight) {
  return (
    flight.date &&
    flight.heure &&
    !flight.statut?.toLowerCase().includes("annulé") &&
    /^\d{2}:\d{2}$/.test(flight.heure)
  );
}

function getQuietSlots(allFlights) {
  const now = new Date();

  const futureFlights = allFlights
    .filter(isValidFlight)
    .map(f => ({ ...f, datetime: parseDateTime(f) }))
    .filter(f => f.datetime && f.datetime > now)
    .sort((a, b) => a.datetime - b.datetime);

  const quietSlots = [];

  // Premier créneau (maintenant -> 1er vol)
  if (futureFlights.length && (futureFlights[0].datetime - now >= 30 * 60000)) {
    quietSlots.push({
      debut: now.toISOString().slice(0, 16).replace('T', ' '),
      fin: futureFlights[0].datetime.toISOString().slice(0, 16).replace('T', ' '),
      duree: Math.floor((futureFlights[0].datetime - now) / 60000)
    });
  }

  // Gaps entre les vols
  for (let i = 1; i < futureFlights.length; i++) {
    const prev = futureFlights[i - 1].datetime;
    const next = futureFlights[i].datetime;
    const gap = (next - prev) / 60000;

    if (gap >= 30) {
      quietSlots.push({
        debut: prev.toISOString().slice(0, 16).replace('T', ' '),
        fin: next.toISOString().slice(0, 16).replace('T', ' '),
        duree: Math.floor(gap)
      });
    }
  }

  return quietSlots;
}

// ROUTE : /quiet-slots
app.get('/quiet-slots', async (req, res) => {
  try {
    const response = await fetch('http://localhost:3000/flights');
    const data = await response.json();

    const allFlights = [...data.volsDepart, ...data.volsArrivee];

    const parseDatetime = (f) => {
      if (!f.date || !f.heure) return null;
      const dateTimeStr = `${f.date}T${f.heure.padStart(5, '0')}:00`;
      const dt = new Date(dateTimeStr);
      return isNaN(dt) ? null : dt;
    };

    const flightTimes = allFlights
      .map(parseDatetime)
      .filter(Boolean)
      .sort((a, b) => a - b);

    const now = new Date();
    const quietSlots = [];

    // Créneau avant le premier vol
    if (flightTimes.length > 0 && (flightTimes[0] - now) / 60000 >= 30) {
      quietSlots.push({
        debut: now.toISOString().replace('T', ' ').slice(0, 16),
        fin: flightTimes[0].toISOString().replace('T', ' ').slice(0, 16),
        duree: Math.floor((flightTimes[0] - now) / 60000)
      });
    }

    // Créneaux entre les vols
    for (let i = 1; i < flightTimes.length; i++) {
      const prev = flightTimes[i - 1];
      const next = flightTimes[i];
      const diff = (next - prev) / 60000;
      if (diff >= 30) {
        quietSlots.push({
          debut: prev.toISOString().replace('T', ' ').slice(0, 16),
          fin: next.toISOString().replace('T', ' ').slice(0, 16),
          duree: Math.floor(diff)
        });
      }
    }

    res.json({ quietSlots });

  } catch (error) {
    console.error("Erreur quiet-slots:", error);
    res.status(500).json({ message: "Erreur lors du calcul des créneaux." });
  }
});
