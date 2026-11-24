// A plain build marker shared by the /seb page and /api/seb/version. No imports, so it is safe to use in
// the client bundle. Bump it on every /seb deploy; the device and the version endpoint then prove which
// build is actually running on Coolify.
export const SEB_BUILD_TAG = 'seb-20261124b';
