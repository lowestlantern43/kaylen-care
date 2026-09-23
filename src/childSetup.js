// The caller retains this progress object until both writes succeed.
export async function saveChildSetup({ api, familyId, basics, profile, progress }) {
  if (!progress.child) {
    progress.child = await api.createChild(familyId, { ...basics, firstName: basics.firstName.trim() });
  }
  const savedProfile = await api.updateChildProfile(familyId, progress.child.id, profile);
  return { child: progress.child, profile: savedProfile };
}
