module.exports = async function handler(_req, res) {
  res.status(410).json({
    error: "Deprecated endpoint",
    message: "Use /api/participants with action add/remove/refresh instead.",
  });
};
