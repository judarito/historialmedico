import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
  }),
});

export class NotificationService {

  static async registerForPushNotifications(): Promise<string | null> {
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

    try {
      const projectId = process.env.EXPO_PUBLIC_PROJECT_ID;
      const tokenData = projectId
        ? await Notifications.getExpoPushTokenAsync({ projectId })
        : await Notifications.getExpoPushTokenAsync();

      const token = tokenData.data;
      await NotificationService.savePushToken(token);
      return token;
    } catch {
      return null;
    }
  }

  static async savePushToken(token: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('profiles').update({ push_token: token }).eq('id', user.id);
  }

  static async showLocalNotification(title: string, body: string): Promise<void> {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: 'default' },
      trigger: null,
    });
  }
}
