const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const fetch = require('node-fetch').default;
const { sanitize } = require('../utils/security');
const API_KEY = process.env.OPENWEATHER_API_KEY;
// Pobierz pogodę + zapisz do bazy
router.post('/', async (req, res) => {
  const { location } = req.body;
  const userId = req.user.id;
  const sanitizedLocation = sanitize(location || 'Bydgoszcz');
  try {
    // 1. Pobierz koordynaty
    const geoRes = await fetch(
      `http://api.openweathermap.org/geo/1.0/direct?q=${sanitizedLocation}&limit=1&appid=${API_KEY}`
    );
    const geoData = await geoRes.json();
    if (!geoData[0]) return res.status(404).json({ error: 'Miasto nie znalezione' });
    const { lat, lon, name, country } = geoData[0];
    // 2. Zapisz lokalizację (lub pobierz istniejącą)
    let locResult = await pool.query(
      `SELECT id FROM locations WHERE name = $1 AND latitude = $2 AND longitude = $3`,
      [name, lat, lon]
    );
    let locationId;
    if (locResult.rows.length === 0) {
      const insertLoc = await pool.query(
        `INSERT INTO locations (name, latitude, longitude, country)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [name, lat, lon, country || null]
      );
      locationId = insertLoc.rows[0].id;
    } else {
      locationId = locResult.rows[0].id;
    }
    // 3. Pobierz pogodę
    const weatherRes = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=pl`
    );
    const weatherData = await weatherRes.json();
    // 4. Log zapytania
    await pool.query(
      `INSERT INTO api_requests (user_id, location_id, request_time, endpoint, parameters, response_status, response_data)
       VALUES ($1, $2, NOW(), $3, $4, $5, $6)`,
      [userId, locationId, weatherRes.url, {}, weatherRes.status, weatherData]
    );
    // 5. Zapisz obserwację (używając rzeczywistego czasu obserwacji z API)
    const obsTime = new Date(weatherData.dt * 1000 + weatherData.timezone * 1000);
    await pool.query(
      `INSERT INTO weather_observations
       (location_id, observation_time, temperature, clouds, humidity, pressure, wind_speed, wind_direction, weather_description, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        locationId,
        obsTime,
        weatherData.main.temp,
        weatherData.clouds.all,
        weatherData.main.humidity,
        weatherData.main.pressure,
        weatherData.wind.speed,
        weatherData.wind.deg,
        weatherData.weather[0].description,
        weatherData
      ]
    );
    // Oblicz bieżący czas lokalny dla wyświetlenia (używając offsetu timezone)
    const adjustedDate = new Date(Date.now() + weatherData.timezone * 1000);
    const currentLocalTime = adjustedDate.toLocaleString('pl-PL', { timeZone: 'UTC' });
    res.json({
      city: weatherData.name,
      temp: weatherData.main.temp,
      humidity: weatherData.main.humidity,
      wind: weatherData.wind.speed,
      windDir: weatherData.wind.deg,
      pressure: weatherData.main.pressure,
      clouds: weatherData.clouds.all,
      time: currentLocalTime, // Użyj bieżącego czasu zamiast czasu obserwacji
      icon: getIcon(weatherData.clouds.all)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Błąd serwera' });
  }
});
// Pobierz historię pogodową z ostatnich 24 godzin
router.post('/history', async (req, res) => {
  const { location } = req.body;
  const userId = req.user.id;
  const sanitizedLocation = sanitize(location || 'Bydgoszcz');
  try {
    // 1. Pobierz koordynaty
    const geoRes = await fetch(
      `http://api.openweathermap.org/geo/1.0/direct?q=${sanitizedLocation}&limit=1&appid=${API_KEY}`
    );
    const geoData = await geoRes.json();
    if (!geoData[0]) return res.status(404).json({ error: 'Miasto nie znalezione' });
    const { lat, lon, name, country } = geoData[0];
    // 2. Zapisz lokalizację (lub pobierz istniejącą)
    let locResult = await pool.query(
      `SELECT id FROM locations WHERE name = $1 AND latitude = $2 AND longitude = $3`,
      [name, lat, lon]
    );
    let locationId;
    if (locResult.rows.length === 0) {
      const insertLoc = await pool.query(
        `INSERT INTO locations (name, latitude, longitude, country)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [name, lat, lon, country || null]
      );
      locationId = insertLoc.rows[0].id;
    } else {
      locationId = locResult.rows[0].id;
    }
    // 3. Oblicz timestamps
    const now = Math.floor(Date.now() / 1000);
    const dataPoints = [];
    let timezone_offset = 0; // Domyślny, zaktualizujemy z pierwszej odpowiedzi
    for (let i = 24; i >= 0; i--) {
      const dt = now - i * 3600;
      const historyRes = await fetch(
        `https://api.openweathermap.org/data/3.0/onecall/timemachine?lat=${lat}&lon=${lon}&dt=${dt}&appid=${API_KEY}&units=metric&lang=pl`
      );
      const historyData = await historyRes.json();
      if (historyData.data && historyData.data[0]) {
        const weather = historyData.data[0];
        if (i === 24) timezone_offset = historyData.timezone_offset; // Weź offset z najstarszego lub bieżącego
        const adjustedTime = new Date(dt * 1000 + timezone_offset * 1000);
        const localTime = adjustedTime.toLocaleTimeString('pl-PL', { timeZone: 'UTC' });
        dataPoints.push({
          time: localTime,
          temp: weather.temp,
          humidity: weather.humidity,
          wind: weather.wind_speed,
          windDir: weather.wind_deg,
          pressure: weather.pressure,
          clouds: weather.clouds
        });
        // Log zapytania (opcjonalnie dla każdego)
        await pool.query(
          `INSERT INTO api_requests (user_id, location_id, request_time, endpoint, parameters, response_status, response_data)
           VALUES ($1, $2, NOW(), $3, $4, $5, $6)`,
          [userId, locationId, historyRes.url, {dt: dt}, historyRes.status, historyData]
        );
      }
      // Delay aby uniknąć rate limit (ok. 1/s)
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    res.json(dataPoints);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Błąd serwera' });
  }
});
function getIcon(clouds) {
  if (clouds < 20) return '☀';
  if (clouds < 80) return '⛅';
  return '☁';
}
module.exports = router;