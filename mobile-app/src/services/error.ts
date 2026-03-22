export function getApiErrorMessage(error: any, fallback = 'Vui lòng thử lại.') {
  const directMessage = error?.response?.data?.message;
  if (typeof directMessage === 'string' && directMessage.trim()) {
    return directMessage;
  }

  const validationMessage = error?.response?.data?.errors?.[0]?.msg;
  if (typeof validationMessage === 'string' && validationMessage.trim()) {
    return validationMessage;
  }

  const noResponse = !error?.response;
  const isNetworkError = noResponse || error?.code === 'ERR_NETWORK' || error?.code === 'ECONNABORTED';

  if (isNetworkError) {
    const baseUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api';
    return `Không kết nối được backend (${baseUrl}). Hãy kiểm tra backend đang chạy và điện thoại cùng mạng với máy dev.`;
  }

  return fallback;
}
