const config = require('../config');

function errorHandler(err, req, res, next) {
  console.error('[SERVER ERROR]', err);

  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : 'An internal server error occurred.';

  res.status(statusCode).json({
    success: false,
    message,
    ...(config.nodeEnv === 'development' ? { stack: err.stack } : {})
  });
}

module.exports = errorHandler;

