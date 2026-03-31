import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { captureException } from './runtimeDiagnostics';

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge:  true,
    }),
  });
} catch (error) {
  void captureException('notifications.setNotificationHandler', error);
}

export class NotificationService {
  private static lastHandledResponseId: string | null = null;

  static async registerForPushNotifications(): Promise<string | null> {
    try {
      // Expo notifications no soporta push web; no debe bloquear el arranque.
      if (Platform.OS === 'web') return null;

      if (!Device.isDevice) return null;

      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;

      if (existing !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') return null;

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('medications', {
          name:              'Medicamentos',
          importance:        Notifications.AndroidImportance.HIGH,
          vibrationPattern:  [0, 250, 250, 250],
          sound:             'default',
        });
        await Notifications.setNotificationChannelAsync('exams', {
          name:       'Exámenes',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
        await Notifications.setNotificationChannelAsync('appointments', {
          name:       'Citas medicas',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 300, 200, 300],
          sound:      'default',
        });
      }

      const projectId = process.env.EXPO_PUBLIC_PROJECT_ID;
      const tokenData = projectId
        ? await Notifications.getExpoPushTokenAsync({ projectId })
        : await Notifications.getExpoPushTokenAsync();

      const token = tokenData.data;
      await NotificationService.savePushToken(token);
      return token;
    } catch (error) {
      await captureException('NotificationService.registerForPushNotifications', error);
      return null;
    }
  }

  static async savePushToken(token: string): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('profiles').update({ push_token: token }).eq('id', user.id);
    } catch (error) {
      await captureException('NotificationService.savePushToken', error, {
        extra: { tokenPreview: token.slice(0, 12) },
      });
    }
  }

  static async showLocalNotification(title: string, body: string): Promise<void> {
    try {
      if (Platform.OS === 'web') return;

      await Notifications.scheduleNotificationAsync({
        content: { title, body, sound: 'default' },
        trigger: null,
      });
    } catch (error) {
      await captureException('NotificationService.showLocalNotification', error, {
        extra: { title },
      });
    }
  }

  private static getRouteFromData(data: Record<string, unknown> | null | undefined): string {
    const visitId = typeof data?.medical_visit_id === 'string' ? data.medical_visit_id : null;
    if (visitId) return `/(app)/visit/${visitId}`;

    const memberId = typeof data?.family_member_id === 'string' ? data.family_member_id : null;
    if (memberId) return `/(app)/member/${memberId}`;

    return '/(app)/notifications';
  }

  private static handleResponse(
    response: Notifications.NotificationResponse | null,
    onOpen: (route: string) => void
  ) {
    if (!response) return;

    const identifier = response.notification.request.identifier;
    if (identifier && NotificationService.lastHandledResponseId === identifier) {
      return;
    }

    NotificationService.lastHandledResponseId = identifier;
    const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
    onOpen(NotificationService.getRouteFromData(data));
    void Notifications.clearLastNotificationResponseAsync().catch((error) => {
      void captureException('NotificationService.clearLastNotificationResponseAsync', error);
    });
  }

  static subscribeToNotificationOpens(onOpen: (route: string) => void): () => void {
    if (Platform.OS === 'web') {
      return () => {};
    }

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      NotificationService.handleResponse(response, onOpen);
    });

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        NotificationService.handleResponse(response, onOpen);
      })
      .catch((error) => {
        void captureException('NotificationService.getLastNotificationResponseAsync', error);
      });

    return () => {
      subscription.remove();
    };
  }
}
