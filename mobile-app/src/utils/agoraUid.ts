export const deriveAgoraUid = (value: string): number => {
  const input = String(value || '');
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }

  // Agora uid must be a positive 32-bit integer (practically).
  const uid = (hash % 2_000_000_000) + 1;
  return uid;
};
