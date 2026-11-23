"use client";
import { useTelemetry } from '../contexts/TelemetryContext';

export const useFactoryTelemetry = () => {
  const { looms, ambient, solar, shiftKpis, gatewayHealth, connectionStatus, isLiveGateway, mockMode } = useTelemetry();

  const loomList = Object.values(looms);

  return {
    factoryState: {
      ambient: {
        temperature_c: ambient.hallTemperatureCelsius,
        humidity_percent: ambient.hallHumidityPercentage,
        air_pressure_bar: ambient.mainAirPressureBar,
      },
      running_looms: shiftKpis.activeLoomsCount,
      stopped_looms: shiftKpis.stoppedLoomsCount,
      offline_looms: shiftKpis.offlineLoomsCount,
      average_efficiency: shiftKpis.averageEfficiency,
      looms: loomList,
    },
    shiftKpis,
    gatewayHealth,
    solar,
    connectionStatus,
    isLiveGateway,
    mockMode: mockMode ?? false,
    loading: false,
    error: null,
  };
};
