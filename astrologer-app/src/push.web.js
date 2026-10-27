// Browsers don't get push notifications in this app; requests arrive through the open page only.
export const getPushToken = () => null;
export async function registerForPush() { return null; }
export function onRequestTapped() { return () => {}; }
