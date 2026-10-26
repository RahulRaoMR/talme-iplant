function skillPattern(value) {
  const term = String(value || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `(^|[^a-z0-9_+#])${term}($|[^a-z0-9_+#])`;
}

function matchesSkill(text, value) {
  return new RegExp(skillPattern(value), "i").test(String(text || ""));
}

module.exports = { skillPattern, matchesSkill };
