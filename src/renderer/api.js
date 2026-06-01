export async function desktopInvoke(channel, payload) {
  if (!window.phantomDesktop || typeof window.phantomDesktop.invoke !== 'function') {
    throw new Error('Desktop bridge is unavailable.');
  }

  const response = await window.phantomDesktop.invoke(channel, payload);
  if (!response || response.ok === false) {
    throw new Error(response?.error || 'Desktop request failed.');
  }

  return response.data ?? response;
}
