import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Colors, Typography, Radius } from '../../theme';

interface AvatarProps {
  name: string;
  imageUrl?: string | null;
  size?: number;
  statusColor?: string;
}

export function Avatar({ name, imageUrl, size = 44, statusColor }: AvatarProps) {
  const initials = name
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <View style={{ position: 'relative' }}>
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
        />
      ) : (
        <View
          style={[
            styles.placeholder,
            { width: size, height: size, borderRadius: size / 2 }
          ]}
        >
          <Text style={[styles.initials, { fontSize: size * 0.35 }]}>{initials}</Text>
        </View>
      )}

      {statusColor && (
        <View
          style={[
            styles.statusDot,
            {
              width: size * 0.28,
              height: size * 0.28,
              borderRadius: size * 0.14,
              backgroundColor: statusColor,
              bottom: 0,
              right: 0,
            }
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: Colors.surface,
  },
  placeholder: {
    backgroundColor: Colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: Colors.textSecondary,
    fontWeight: Typography.semibold,
  },
  statusDot: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: Colors.background,
  },
});
