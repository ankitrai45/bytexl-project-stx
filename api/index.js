const app = require('../server');

module.exports = (req, res) => {
  // If Vercel rewrites stripped the /api prefix, ensure req.url starts with /api
  if (req.url && !req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return app(req, res);
};
