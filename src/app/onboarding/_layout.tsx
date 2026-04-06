import { Stack } from 'expo-router';
import { Colors } from '../../theme';

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="member" />
      <Stack.Screen name="contact" />
    </Stack>
  );
}
