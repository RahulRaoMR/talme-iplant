function healthCheck(req, res) {
  res.status(200).json({
    success: true,
    message: "Candidate Backend Running"
  });
}

module.exports = { healthCheck };
