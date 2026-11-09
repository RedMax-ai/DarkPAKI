// XSS Sanitizer: Escape dangerous HTML characters
function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str
    .trim()
    .replace(/[&<>"']/g, (match) => {
      const escapeMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;'
      };
      return escapeMap[match];
    });
}

// Gmail Validation
function validateGmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email address is required.' };
  }
  const clean = email.trim().toLowerCase();
  if (!clean.endsWith('@gmail.com')) {
    return { valid: false, error: 'Only official @gmail.com addresses are permitted.' };
  }
  const username = clean.split('@')[0];
  if (username.length < 4) {
    return { valid: false, error: 'Gmail username must be at least 4 characters long.' };
  }
  const fakePatterns = ['test', 'fake', 'temp', 'bot', 'admin', '12345', 'qwerty', 'asdf', 'demo'];
  if (fakePatterns.some(p => username === p || username.startsWith(p + '1'))) {
    return { valid: false, error: 'Suspicious or disposable Gmail pattern detected.' };
  }
  if (/^[0-9]+$/.test(username)) {
    return { valid: false, error: 'Purely numeric Gmail addresses are blocked for bot prevention.' };
  }
  return { valid: true, email: clean };
}

// Indian Phone Validation (10 digits starting with 6-9)
function validatePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, error: 'Mobile number is required.' };
  }
  const clean = phone.trim();
  if (!/^[6-9]\d{9}$/.test(clean)) {
    return { valid: false, error: 'Mobile number must be a valid 10-digit number starting with 6-9.' };
  }
  return { valid: true, phone: clean };
}

// Device ID Validation
function validateDeviceId(deviceId) {
  if (!deviceId || typeof deviceId !== 'string' || deviceId.trim().length < 5) {
    return { valid: false, error: 'Valid Device Fingerprint is required.' };
  }
  return { valid: true, deviceId: sanitizeString(deviceId) };
}

module.exports = {
  sanitizeString,
  validateGmail,
  validatePhone,
  validateDeviceId
};

