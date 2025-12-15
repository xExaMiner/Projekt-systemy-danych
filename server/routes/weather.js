const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const fetch = require('node-fetch').default;
const { sanitize } = require('../utils/security');
const rateLimit = require('express-rate-limit');
const API_KEY = process.env.OPENWEATHER_API_KEY;

// Rate limiter: 10 requests per 24 hours for non-Admin users
const weatherLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user && req.user.username === 'Admin', // Unlimited for Admin
  keyGenerator: (req) => {
    if (req.user && req.user.username === 'Admin') {
      return 'admin-unlimited';
    }
    return req.user ? `user-${req.user.id}` : req.ip;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Zbyt wiele zapytań o pogodę. Limit: 10 na 24 godziny.'
    });
  }
});

// Pobierz pogodę + zapisz do bazy
router.post('/', weatherLimiter, async (req, res) => {
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

    // 2. Zapisz lokalizację (lub pobierz/aktualizuj istniejącą)
    let locResult = await pool.query(
      `SELECT id, latitude, longitude, country FROM locations WHERE name = $1`,
      [name]
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

    // 5. Zapisz obserwację
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

    // Zapisz prognozę do bazy danych
    for (const hour of forecast) {
      await pool.query(
        `INSERT INTO weather_forecasts (location_id, forecast_time, predicted_temperature, predicted_humidity, predicted_pressure, predicted_wind_speed, predicted_wind_direction, predicted_clouds, generation_method, model_used)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [locationId, hour.time, hour.temp, hour.humidity, hour.pressure, hour.wind, hour.windDir, hour.clouds, 'api', 'openweathermap']
      );
    }

    // Generuj komentarz AI za pomocą Hugging Face
    let commentary = '';
    try {
      const prompt = `Jesteś doświadczonym meteorologiem. Na podstawie poniższej prognozy pogody na następne 24 godziny dla miasta ${weatherData.name}, napisz profesjonalną prognozę jak prawdziwy prezenter pogody w języku polskim. Nie używaj znaków specjalnych i wykorzystaj do 500 znaków. Prognoza: ${JSON.stringify(forecast)}`;
      const aiRes = await fetch('https://router.huggingface.co/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.HF_TOKEN}`
        },
        body: JSON.stringify({
          model: 'swiss-ai/Apertus-70B-Instruct-2509',
          messages: [
            { role: 'user', content: prompt }
          ],
          max_tokens: 300,
          temperature: 0.7
        })
      });
      if (!aiRes.ok) {
        console.error('HF API error:', aiRes.status, await aiRes.text());
        commentary = 'Nie udało się wygenerować komentarza AI.';
      } else {
        const aiData = await aiRes.json();
        console.log('HF response:', aiData);
        commentary = aiData.choices[0]?.message?.content?.trim() || 'Nie udało się wygenerować komentarza.';
      }
    } catch (err) {
      console.error('AI error:', err);
      commentary = 'Błąd generowania komentarza AI.';
    }

    // Oblicz bieżący czas lokalny
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
      time: currentLocalTime,
      icon: getIcon(weatherData.clouds.all),
      history: history,
      forecast: forecast,
      commentary: commentary,
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