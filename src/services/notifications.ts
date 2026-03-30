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
}
