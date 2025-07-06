const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Fonction de scraping générique
const scrapeFlights = async (url, type) => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.card-flight__top', { timeout: 5000 });

  const now = new Date();
  let currentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let previousTime = null;

  const results = await page.evaluate((type) => {
    const cards = document.querySelectorAll('.card-flight__top');
    const extracted = [];

    cards.forEach(card => {
      const getText = (label) => {
        const el = Array.from(card.querySelectorAll('.card-flight__label')).find(l => l.textContent.includes(label));
        return el?.nextElementSibling?.textContent.trim() || null;
      };

      extracted.push({
        type,
        heure: getText(type === 'Départ' ? "Heure de départ programmée" : "Heure d'arrivée programmée"),
        destination: type === 'Départ' ? getText("Destination") : "Nantes",
        compagnie: card.querySelector('.card-flight__data--logo img')?.alt?.trim() || null,
        numeroVol: getText("N° vol"),
        statut: getText("Statut de vol")
      });
    });

    return extracted;
  }, type);

  const resultsWithDate = results.map(v => {
    if (!v.heure || !/\d{2}:\d{2}/.test(v.heure)) return { ...v, date: null };
    const [h, m] = v.heure.split(':').map(Number);
    let date = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), h, m);

    if (previousTime && date < previousTime) {
      date.setDate(date.getDate() + 1);
    }

    previousTime = date;
    return {
      ...v,
      date: date.toISOString().slice(0, 10)
    };
  });

  await browser.close();
  return resultsWithDate;
};

// Endpoint pour afficher tous les vols
app.get('/flights', async (req, res) => {
  try {
    const urlDepart = 'https://www.nantes.aeroport.fr/fr/trouvez-votre-destination/vols-au-depart';
    const urlArrivee = 'https://www.nantes.aeroport.fr/fr/trouvez-votre-destination/vols-en-arrivee';

    const [volsDepart, volsArrivee] = await Promise.all([
      scrapeFlights(urlDepart, 'Départ'),
      scrapeFlights(urlArrivee, 'Arrivée')
    ]);

    const tousLesVols = [...volsDepart, ...volsArrivee].filter(v => v.heure && v.date);

    tousLesVols.sort((a, b) => {
      const dateA = new Date(`${a.date}T${a.heure}:00`);
      const dateB = new Date(`${b.date}T${b.heure}:00`);
      return dateA - dateB;
    });

    res.json({ vols: tousLesVols });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur lors du scraping des vols." });
  }
});

// Endpoint pour détecter les créneaux de silence aérien
app.get('/quiet-slots', async (req, res) => {
  try {
    const now = new Date();
    const response = await axios.get(`http://localhost:${PORT}/flights`);
    const vols = response.data.vols;

    const volsAvecDatetime = vols
      .filter(v => /^\d{2}:\d{2}$/.test(v.heure))
      .map(v => ({
        ...v,
        datetime: new Date(`${v.date}T${v.heure}:00`)
      }))
      .filter(v => v.datetime >= now)
      .sort((a, b) => a.datetime - b.datetime);

    const quietSlots = [];
    for (let i = 1; i < volsAvecDatetime.length; i++) {
      const prev = volsAvecDatetime[i - 1].datetime;
      const next = volsAvecDatetime[i].datetime;
      const diff = (next - prev) / 60000;
      if (diff >= 30) {
        quietSlots.push({
          debut: prev.toISOString().replace('T', ' ').slice(0, 16),
          fin: next.toISOString().replace('T', ' ').slice(0, 16),
          duree: Math.floor(diff)
        });
      }
    }

    // Slot de maintenant au prochain vol
    if (volsAvecDatetime.length > 0) {
      const first = volsAvecDatetime[0].datetime;
      const diff = (first - now) / 60000;
      if (diff >= 30) {
        quietSlots.unshift({
          debut: now.toISOString().replace('T', ' ').slice(0, 16),
          fin: first.toISOString().replace('T', ' ').slice(0, 16),
          duree: Math.floor(diff)
        });
      }
    }

    res.json({ quietSlots });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur lors du calcul des créneaux." });
  }
});

// Lancer le serveur
app.listen(PORT, () => {
  console.log(`✅ Serveur Node.js en ligne sur le port ${PORT}`);
});
