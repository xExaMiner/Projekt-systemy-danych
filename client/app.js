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
      } catch (err) {
        showError(err.message);
      } finally {
        elements.btn.disabled = false;
        elements.btn.textContent = "Sprawdź";
      }
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