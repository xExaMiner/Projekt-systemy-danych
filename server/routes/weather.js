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
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&lang=pl`
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
        Math.round(weatherData.main.temp - 273.15),
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
      temp: Math.round(weatherData.main.temp - 273.15),
      humidity: weatherData.main.humidity,
      wind: weatherData.wind.speed,
      windDir: weatherData.wind.deg,
      pressure: weatherData.main.pressure,
      clouds: weatherData.clouds.all,
      time: currentLocalTime,  // Użyj bieżącego czasu zamiast czasu obserwacji
      icon: getIcon(weatherData.clouds.all)
    });
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