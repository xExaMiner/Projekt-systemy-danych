// === ELEMENTY ===
const elements = {
  input: document.getElementById("locationInput"),
  btn: document.getElementById("fetchBtn"),
  card: document.getElementById("weatherCard"),
  error: document.getElementById("errorMsg"),
  city: document.getElementById("city"),
  temp: document.getElementById("temp"),
  humidity: document.getElementById("humidity"),
  wind: document.getElementById("wind"),
  windDir: document.getElementById("windDir"),
  pressure: document.getElementById("pressure"),
  clouds: document.getElementById("clouds"),
  time: document.getElementById("time"),
  icon: document.getElementById("icon"),
  container: document.getElementById("weatherContainer"),
  dt: document.getElementById("dt"),
  timezone: document.getElementById("timezone")
};
// === IKONY POGODOWE ===
const icons = {
  clear: "☀",
  partly: "⛅",
  cloudy: "☁",
  rain: "🌧",
  storm: "⛈"
};
// === KIERUNEK WIATRU ===
function getWindDirection(deg) {
  if (deg === undefined || deg === null) return "N/A";
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(deg / 45) % 8;
  return `${deg}° (${directions[index]})`;
}
// === BŁĄD ===
function showError(msg) {
  elements.error.textContent = msg;
  elements.error.classList.remove("hidden");
  elements.card.classList.add("hidden");
}
function hideError() {
  elements.error.classList.add("hidden");
}
let chart = null;
// Set Luxon locale
luxon.Settings.defaultLocale = 'pl';
// === POGODA Z BACKENDU ===
async function fetchWeather() {
  const location = elements.input.value.trim() || "Bydgoszcz";
  if (!location) return showError("Wpisz nazwę miasta.");
  const token = localStorage.getItem('token');
  if (!token) return showError("Zaloguj się, aby sprawdzić pogodę.");
  hideError();
  elements.btn.disabled = true;
  elements.btn.textContent = "Ładowanie...";
  try {
    const res = await fetch('/api/weather', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ location })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Błąd ${res.status}`);
    }
    // Aktualizacja UI
    elements.city.textContent = data.city;
    elements.temp.textContent = `${data.temp}°C`;
    elements.humidity.textContent = `${data.humidity}%`;
    elements.wind.textContent = `${data.wind} m/s`;
    elements.windDir.textContent = getWindDirection(data.windDir);
    elements.pressure.textContent = `${data.pressure} hPa`;
    elements.clouds.textContent = `${data.clouds}%`;
    elements.time.textContent = data.time;
    const iconKey = data.clouds < 20 ? 'clear' : data.clouds < 80 ? 'partly' : 'cloudy';
    elements.icon.textContent = icons[iconKey];
    elements.card.classList.remove("hidden");
    // Obsługa wykresu
    const chartElement = document.getElementById('weatherChart');
    chartElement.classList.remove('hidden');
    let history = data.history || [];
    createChart(history, data.timezone);

    // Nowa sekcja: Wyświetl wszystkie obserwacje z historii (filtrowane do 24h wstecz)
    displayHistory(history, data.timezone);

  } catch (err) {
    showError(err.message);
  } finally {
    elements.btn.disabled = false;
    elements.btn.textContent = "Sprawdź";
  }
}

// Nowa funkcja: Wyświetl historię w tabeli
function displayHistory(history, timezone) {
  // Nie filtruj ponownie - backend już to zrobił
  let filteredHistory = history;

  // Sortuj malejąco po czasie (najnowsze na górze)
  filteredHistory.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  // Stwórz lub wyczyść kontener na historię (dodaj do weatherContainer jeśli nie istnieje)
  let historyDiv = document.getElementById('historyDiv');
  if (!historyDiv) {
    historyDiv = document.createElement('div');
    historyDiv.id = 'historyDiv';
    historyDiv.classList.add('mt-4'); // Dodaj styl, jeśli masz CSS (margines top)
    elements.container.appendChild(historyDiv);
  }
  historyDiv.innerHTML = '';

  if (filteredHistory.length === 0) {
    historyDiv.innerHTML = '<p>Brak obserwacji z ostatnich 24 godzin.</p>';
    return;
  }

  // Użyj luxon do formatowania czasu (zakładam h.time w ISO lub parseowalnym formacie)
  const DateTime = luxon.DateTime;

  // Konwertuj timezone (liczba sekund) na string 'UTC+01:00' itp.
  const offsetSeconds = timezone;
  const hours = Math.floor(offsetSeconds / 3600);
  const minutes = Math.floor(Math.abs(offsetSeconds % 3600) / 60);
  const sign = offsetSeconds >= 0 ? '+' : '-';
  const zoneStr = `UTC${sign}${Math.abs(hours).toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

  // Stwórz tabelę
  let tableHTML = `
    <h3>Historia obserwacji (ostatnie 24h)</h3>
    <table class="table-auto w-full border-collapse border border-gray-300">
      <thead>
        <tr class="bg-gray-200">
          <th class="border px-2 py-1">Czas</th>
          <th class="border px-2 py-1">Temp (°C)</th>
          <th class="border px-2 py-1">Wilgotność (%)</th>
          <th class="border px-2 py-1">Wiatr (m/s)</th>
          <th class="border px-2 py-1">Kierunek wiatru</th>
          <th class="border px-2 py-1">Ciśnienie (hPa)</th>
          <th class="border px-2 py-1">Zachmurzenie (%)</th>
        </tr>
      </thead>
      <tbody>
  `;

  filteredHistory.forEach(h => {
    const dt = DateTime.fromISO(h.time, { zone: zoneStr });
    const formattedTime = dt.isValid ? dt.toFormat('dd MMM yyyy HH:mm') : 'N/A';
    const windDir = getWindDirection(h.windDir);
    tableHTML += `
      <tr>
        <td class="border px-2 py-1">${formattedTime}</td>
        <td class="border px-2 py-1">${h.temp ?? 'N/A'}</td>
        <td class="border px-2 py-1">${h.humidity ?? 'N/A'}</td>
        <td class="border px-2 py-1">${h.wind ?? 'N/A'}</td>
        <td class="border px-2 py-1">${windDir}</td>
        <td class="border px-2 py-1">${h.pressure ?? 'N/A'}</td>
        <td class="border px-2 py-1">${h.clouds ?? 'N/A'}</td>
      </tr>
    `;
  });

  tableHTML += '</tbody></table>';
  historyDiv.innerHTML = tableHTML;
}

// Funkcja do tworzenia wykresu
function createChart(history, timezone) {
  const ctx = document.getElementById('weatherChart').getContext('2d');
  if (chart) {
    chart.destroy();
  }
  const tempData = history.map(h => ({ x: h.time, y: h.temp }));
  const humidityData = history.map(h => ({ x: h.time, y: h.humidity }));
  const windData = history.map(h => ({ x: h.time, y: h.wind }));
  const now = Date.now();
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Temperatura (°C)',
          data: tempData,
          borderColor: 'rgb(255, 99, 132)',
          yAxisID: 'y',
          tension: 0.1
        },
        {
          label: 'Wilgotność (%)',
          data: humidityData,
          borderColor: 'rgb(54, 162, 235)',
          yAxisID: 'y1',
          tension: 0.1
        },
        {
          label: 'Wiatr (m/s)',
          data: windData,
          borderColor: 'rgb(75, 192, 192)',
          yAxisID: 'y1',
          tension: 0.1
        }
      ]
    },
    options: {
      responsive: true,
      adapters: {
        date: {
          locale: 'pl'
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'hour',
            displayFormats: {
              hour: 'HH:mm',
              day: 'd MMM'
            }
          },
          min: twentyFourHoursAgo,
          max: now
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: {
            display: true,
            text: 'Temperatura (°C)'
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          grid: {
            drawOnChartArea: false
          },
          title: {
            display: true,
            text: 'Wilgotność (%) / Wiatr (m/s)'
          }
        }
      }
    }
  });
}
// === AUTORYZACJA ===
const authModal = document.getElementById('authModal');
const modalTitle = document.getElementById('modalTitle');
const authUsername = document.getElementById('authUsername');
const authPassword = document.getElementById('authPassword');
const authEmail = document.getElementById('authEmail');
const authSubmit = document.getElementById('authSubmit');
const switchAuth = document.getElementById('switchAuth');
let currentMode = 'login';
// Otwórz modal
document.getElementById('loginBtn').onclick = () => openAuthModal('login');
document.getElementById('registerBtn').onclick = () => openAuthModal('register');
function openAuthModal(mode) {
  currentMode = mode;
  modalTitle.textContent = mode === 'login' ? 'Zaloguj się' : 'Zarejestruj się';
  authSubmit.textContent = mode === 'login' ? 'Zaloguj' : 'Zarejestruj';
  authEmail.classList.toggle('hidden', mode === 'login');
  switchAuth.textContent = mode === 'login'
    ? 'Nie masz konta? Zarejestruj się'
    : 'Masz konto? Zaloguj się';
  authModal.classList.remove('hidden');
  authModal.classList.add('flex');
  authUsername.focus();
}
document.getElementById('authCancel').onclick = () => {
  authModal.classList.add('hidden');
};
switchAuth.onclick = (e) => {
  e.preventDefault();
  openAuthModal(currentMode === 'login' ? 'register' : 'login');
};
// Logowanie / Rejestracja
authSubmit.onclick = async () => {
  const username = authUsername.value.trim();
  const password = authPassword.value;
  const email = authEmail.value.trim();
  if (!username || !password) {
    alert('Wypełnij wszystkie pola!');
    return;
  }
  const endpoint = currentMode === 'login' ? '/api/auth/login' : '/api/auth/register';
  const body = currentMode === 'login'
    ? { username, password }
    : { username, password, email: email || null };
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (res.ok && data.token) {
      localStorage.setItem('token', data.token);
      authModal.classList.add('hidden');
      updateAuthUI(data.user || { username });
      elements.container.classList.remove('hidden'); // Pokaż stację po logowaniu
      fetchWeather(); // Auto-pobranie po zalogowaniu
    } else {
      alert(data.error || 'Błąd autoryzacji');
    }
  } catch (err) {
    alert('Błąd połączenia z serwerem');
  }
};
// Wylogowanie
document.getElementById('logoutBtn').onclick = () => {
  localStorage.removeItem('token');
  elements.container.classList.add('hidden'); // Ukryj stację
  location.reload();
};
// Sprawdź token przy ładowaniu
async function checkAuth() {
  const token = localStorage.getItem('token');
  if (!token) {
    openAuthModal('login'); // Automatycznie otwórz modal jeśli nie zalogowany
    return;
  }
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const user = await res.json();
      updateAuthUI(user);
      elements.container.classList.remove('hidden'); // Pokaż stację
      fetchWeather();
    } else {
      throw new Error('Nieprawidłowy token');
    }
  } catch (err) {
    localStorage.removeItem('token');
    openAuthModal('login'); // Otwórz modal jeśli token nievalidny
  }
}
function updateAuthUI(user) {
  document.getElementById('loginBtn').classList.add('hidden');
  document.getElementById('registerBtn').classList.add('hidden');
  document.getElementById('userInfo').classList.remove('hidden');
  document.getElementById('username').textContent = user.username;
}
// === EVENTY ===
elements.btn.addEventListener("click", fetchWeather);
elements.input.addEventListener("keypress", (e) => {
  if (e.key === "Enter") fetchWeather();
});
// === START ===
window.addEventListener("load", () => {
  elements.input.value = "Bydgoszcz";
  checkAuth();
});