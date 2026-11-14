import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

/** Full-screen brand splash shown while the stored session loads (the system splash can only show an icon). */
export function BrandSplash({ onShown }: { onShown: () => void }) {
  return (
    <View style={styles.root}>
      <Image
        source={require('../../assets/images/splash.png')}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        accessibilityLabel="Remo Code, code beyond gravity"
        // Hide the system splash only once this is on screen, so there is no blank flash between them.
        onDisplay={onShown}
        onError={onShown}
      />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#04071F' } });
