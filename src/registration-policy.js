const PENDING_MESSAGE = "Your registration is awaiting admin approval. You can log in once approved.";

function isApprovedAccount(user) {
  return Boolean(user?.is_active && user.approval_status === "APPROVED" && !user.deleted_at);
}

function registrationAccessMessage(user) {
  if (user?.approval_status === "PENDING") return PENDING_MESSAGE;
  if (user?.approval_status === "REJECTED") return "Your registration has been rejected by an administrator. You cannot log in. Contact your administrator.";
  if (user?.approval_status === "DELETED" || user?.deleted_at) return "Your account has been deleted and access is blocked. Contact your administrator.";
  return "Your account is not approved for access. Contact your administrator.";
}

module.exports = { PENDING_MESSAGE, isApprovedAccount, registrationAccessMessage };
