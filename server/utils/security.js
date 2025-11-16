// server/utils/security.js
function sanitize(input) {
  if (typeof input !== 'string') return input;
  return input.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&#x27;';
      default: return char;
    }
  }).trim();
}

module.exports = { sanitize };