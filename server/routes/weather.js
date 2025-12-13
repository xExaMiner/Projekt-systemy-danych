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
    // 2. Zapisz lokalizację (lub pobierz/aktualizuj istniejącą) – wyszukuj po name, aby uniknąć duplikatów
    let locResult = await pool.query(
      `SELECT id, latitude, longitude, country FROM locations WHERE name = $1`,
      [name]
    );
    let locationId;
    if (locResult.rows.length === 0) {
      // Insert nowej, jeśli nie istnieje
      const insertLoc = await pool.query(
        `INSERT INTO locations (name, latitude, longitude, country)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [name, lat, lon, country || null]
      );
      locationId = insertLoc.rows[0].id;
    } else {
      // Użyj istniejącej i aktualizuj coords/country, jeśli różnią się
      locationId = locResult.rows[0].id;
      const existingLat = locResult.rows[0].latitude;
      const existingLon = locResult.rows[0].longitude;
      const existingCountry = locResult.rows[0].country;
      if (
        Math.abs(existingLat - lat) > 0.0001 ||
        Math.abs(existingLon - lon) > 0.0001 ||
        existingCountry !== (country || null)
      ) {
        await pool.query(
          `UPDATE locations SET latitude = $1, longitude = $2, country = $3 WHERE id = $4`,
          [lat, lon, country || null, locationId]
        );
      }
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
    // 5. Zapisz obserwację (używając czasu zapytania)
    const obsTime = new Date();
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
    // Pobierz dane historyczne z ostatnich 24 godzin
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const historyResult = await pool.query(
      `SELECT observation_time, temperature, humidity, wind_speed AS wind, pressure, clouds, wind_direction AS "windDir"
       FROM weather_observations
       WHERE location_id = $1 AND observation_time >= $2
       ORDER BY observation_time ASC`,
      [locationId, twentyFourHoursAgo]
    );
    const history = historyResult.rows.map(row => ({
      time: row.observation_time.toISOString(),
      temp: row.temperature,
      humidity: row.humidity,
      wind: row.wind,
      windDir: row.windDir,
      pressure: row.pressure,
      clouds: row.clouds
    }));
    // Pobierz prognozę na następne 24 godziny
    const forecastRes = await fetch(
      `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=minutely,daily,alerts&appid=${API_KEY}`
    );
    const forecastData = await forecastRes.json();
    const forecast = forecastData.hourly.slice(1, 25).map(hour => ({
      time: new Date(hour.dt * 1000).toISOString(),
      temp: (hour.temp - 273.15).toFixed(2),
      humidity: hour.humidity,
      wind: hour.wind_speed,
      windDir: hour.wind_deg,
      pressure: hour.pressure,
      clouds: hour.clouds
    }));
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
      time: currentLocalTime, // Użyj bieżącego czasu zamiast czasu obserwacji
      icon: getIcon(weatherData.clouds.all),
      history: history,
      forecast: forecast,
      timezone: weatherData.timezone
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