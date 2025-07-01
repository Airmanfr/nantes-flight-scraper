const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors()); // autorise les requêtes cross-origin depuis Flutter

// Fonction de scraping partagée
const scrapeFlights = async (url, type, page) => {
  await page.goto(url, { waitUntil: 'networkidle0' });

  return await page.evaluate((type) => {
    const cards = document.querySelectorAll('.card-flight__top');
    const results = [];

    cards.forEach(card => {
      const getText = (label) => {
        const el = Array.from(card.querySelectorAll('.card-flight__label')).find(l => l.textContent.includes(label));
        return el?.nextElementSibling?.textContent.trim() || null;
      };

      results.push({
        type,
        heure: getText(type === 'Départ' ? "Heure de départ programmée" : "Heure d'arrivée programmée"),
        destination: type === 'Départ' ? getText("Destination") : "Nantes",
        provenance: type === 'Arrivée' ? getText("Provenance") : null,
        compagnie: card.querySelector('.card-flight__data--logo img')?.alt?.trim() || null,
        numeroVol: getText("N° vol"),
        statut: getText("Statut de vol")
      });
    });

    return results;
  }, type);
};

// Endpoint API REST pour récupérer les vols
app.get('/flights', async (req, res) => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  try {
    const urlDepart = 'https://www.nantes.aeroport.fr/fr/trouvez-votre-destination/vols-au-depart';
    const urlArrivee = 'https://www.nantes.aeroport.fr/fr/trouvez-votre-destination/vols-en-arrivee';

    const volsDepart = await scrapeFlights(urlDepart, 'Départ', page);
    const volsArrivee = await scrapeFlights(urlArrivee, 'Arrivée', page);

    res.json({ volsDepart, volsArrivee });
  } catch (err) {
    console.error('Erreur de scraping:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    await browser.close();
  }
});

// Endpoint pour détecter les créneaux de silence
app.get('/quiet-slots', async (req, res) => {
  try {
    const urlDepart = 'https://www.nantes.aeroport.fr/fr/trouvez-votre-destination/vols-au-depart';
    const urlArrivee = 'https://www.nantes.aeroport.fr/fr/trouvez-votre-destination/vols-en-arrivee';

    const [volsDepart, volsArrivee] = await Promise.all([
      scrapeFlights(urlDepart, 'Départ'),
      scrapeFlights(urlArrivee, 'Arrivée')
    ]);

    const allFlights = [...volsDepart, ...volsArrivee];

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


function minutesToHHMM(minutes) {
  const h = Math.floor(minutes / 60).toString().padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`Serveur Node.js démarré sur http://localhost:${PORT}`);
});
