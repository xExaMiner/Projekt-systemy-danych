-- Użytkownicy
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) CHECK (role IN ('admin', 'user')) NOT NULL DEFAULT 'user',
  email VARCHAR(100),
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Lokalizacje
CREATE TABLE locations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  latitude DECIMAL(9,6) NOT NULL,
  longitude DECIMAL(9,6) NOT NULL,
  country VARCHAR(50),
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Obserwacje pogodowe
CREATE TABLE weather_observations (
  id SERIAL PRIMARY KEY,
  location_id INTEGER REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
  observation_time TIMESTAMP NOT NULL,
  temperature DECIMAL(5,2),
  clouds INTEGER,
  humidity INTEGER,
  pressure INTEGER,
  wind_speed DECIMAL(5,2),
  wind_direction INTEGER,
  weather_description TEXT,
  raw_data JSONB,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Prognozy
CREATE TABLE weather_forecasts (
  id SERIAL PRIMARY KEY,
  location_id INTEGER REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
  forecast_time TIMESTAMP NOT NULL,
  predicted_temperature DECIMAL(5,2),
  predicted_clouds INTEGER,
  predicted_humidity INTEGER,
  predicted_pressure INTEGER,
  predicted_wind_speed DECIMAL(5,2),
  predicted_wind_direction INTEGER,
  forecast_description TEXT,
  generation_method VARCHAR(20) CHECK (generation_method IN ('api', 'ai_ollama', 'other')) DEFAULT 'api',
  model_used VARCHAR(100),
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Logi zapytań API
CREATE TABLE api_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
  request_time TIMESTAMP NOT NULL,
  endpoint VARCHAR(255) NOT NULL,
  parameters JSONB,
  response_status INTEGER,
  response_data JSONB,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audyt
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL,
  table_name VARCHAR(50) NOT NULL,
  record_id INTEGER NOT NULL,
  old_value JSONB,
  new_value JSONB,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger do audytu (przykład dla users)
CREATE OR REPLACE FUNCTION audit_users()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value)
    VALUES (NEW.id, 'UPDATE', 'users', NEW.id, to_jsonb(OLD), to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value)
    VALUES (OLD.id, 'DELETE', 'users', OLD.id, to_jsonb(OLD));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_audit_users
AFTER UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION audit_users();