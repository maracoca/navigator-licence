import React, { useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { LatLng, Marker, Polyline } from 'react-native-maps';
import type { PlanResponse } from '../api/types';
import { colors } from '../theme';

export function RouteMap({ plan }: { plan: PlanResponse }) {
  const mapRef = useRef<MapView>(null);

  const allCoords = useMemo<LatLng[]>(() => {
    const pts: LatLng[] = [
      { latitude: plan.origin.lat, longitude: plan.origin.lng },
      { latitude: plan.destination.lat, longitude: plan.destination.lng },
      ...plan.stops.map((s) => ({ latitude: s.lat, longitude: s.lng })),
    ];
    for (const leg of plan.legs) for (const [lat, lng] of leg.points) pts.push({ latitude: lat, longitude: lng });
    return pts;
  }, [plan]);

  const initialRegion = useMemo(() => {
    const lats = allCoords.map((c) => c.latitude);
    const lngs = allCoords.map((c) => c.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.005, (maxLat - minLat) * 1.4),
      longitudeDelta: Math.max(0.005, (maxLng - minLng) * 1.4),
    };
  }, [allCoords]);

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={initialRegion}
      showsUserLocation={false}
      onMapReady={() =>
        mapRef.current?.fitToCoordinates(allCoords, {
          edgePadding: { top: 40, right: 40, bottom: 40, left: 40 },
          animated: false,
        })
      }
    >
      {plan.legs.map((leg, i) => (
        <Polyline
          key={`leg-${i}`}
          coordinates={leg.points.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))}
          strokeColor={colors.route}
          strokeWidth={5}
        />
      ))}
      <Marker
        coordinate={{ latitude: plan.origin.lat, longitude: plan.origin.lng }}
        title={`Start: ${plan.origin.name}`}
        pinColor={colors.origin}
      />
      <Marker
        coordinate={{ latitude: plan.destination.lat, longitude: plan.destination.lng }}
        title={`End: ${plan.destination.name}`}
        pinColor={colors.destination}
      />
      {plan.stops.map((s, i) => (
        <Marker
          key={`stop-${s.itemId}-${i}`}
          coordinate={{ latitude: s.lat, longitude: s.lng }}
          title={`${i + 1}. ${s.name}`}
          description={s.label}
          anchor={{ x: 0.5, y: 0.5 }}
        >
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{i + 1}</Text>
          </View>
        </Marker>
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
