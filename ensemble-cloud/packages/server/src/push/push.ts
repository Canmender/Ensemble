const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const token = process.env.EXPO_ACCESS_TOKEN;

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: string;
  badge?: number;
}

export interface PushResponse {
  data: {
    status: string;
    id: string;
  }[];
}

export async function sendExpoPush(
  pushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<PushResponse> {
  if (!token) {
    throw new Error("EXPO_ACCESS_TOKEN not set");
  }

  const message: PushMessage = {
    to: pushToken,
    title,
    body,
    data,
    sound: "default",
  };

  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Expo push failed: ${res.status} ${errorText}`);
  }

  return res.json() as Promise<PushResponse>;
}

export async function sendExpoPushBatch(
  messages: PushMessage[],
): Promise<PushResponse> {
  if (!token) {
    throw new Error("EXPO_ACCESS_TOKEN not set");
  }

  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(messages),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Expo push batch failed: ${res.status} ${errorText}`);
  }

  return res.json() as Promise<PushResponse>;
}
