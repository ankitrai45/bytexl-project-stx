const jwt = require('jsonwebtoken');

module.exports = function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('CRITICAL: JWT_SECRET environment variable is missing.');
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  try {
    const payload = jwt.verify(token, secret);
    req.user = { id: Number(payload.id), email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
};
