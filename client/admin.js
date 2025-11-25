// Sprawdź autoryzację przy ładowaniu
async function checkAdminAuth() {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '/';
    return;
  }
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const user = await res.json();
      if (user.username !== 'Admin') {
        window.location.href = '/';
      }
    } else {
      throw new Error('Nieprawidłowy token');
    }
  } catch (err) {
    localStorage.removeItem('token');
    window.location.href = '/';
  }
}

// Obsługa przycisku usuwania
const deleteOldBtn = document.getElementById('deleteOldBtn');
const statusMsg = document.getElementById('statusMsg');

deleteOldBtn.addEventListener('click', async () => {
  const token = localStorage.getItem('token');
  if (!token) {
    statusMsg.textContent = 'Nie jesteś zalogowany.';
    statusMsg.classList.remove('hidden');
    return;
  }
  deleteOldBtn.disabled = true;
  deleteOldBtn.textContent = 'Usuwanie...';
  statusMsg.classList.add('hidden');
  try {
    const res = await fetch('/api/delete-old', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (res.ok) {
      statusMsg.textContent = data.message || 'Stare dane zostały usunięte.';
      statusMsg.classList.remove('hidden');
    } else {
      throw new Error(data.error || 'Błąd usuwania');
    }
  } catch (err) {
    statusMsg.textContent = err.message;
    statusMsg.classList.remove('hidden');
  } finally {
    deleteOldBtn.disabled = false;
    deleteOldBtn.textContent = 'Usuń stare dane (starsze niż 24h)';
  }
});

// Start
window.addEventListener('load', checkAdminAuth);