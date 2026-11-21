"use client";
import { useTelemetry } from '../contexts/TelemetryContext';

export const useFactoryTelemetry = () => {
  const { looms, shiftKpis, systemStatus } = useTelemetry();
  const loomList = Object.values(looms);

  return {
    factoryState: {
      running_looms: shiftKpis.activeLoomsCount,
      stopped_looms: shiftKpis.stoppedLoomsCount,
      offline_looms: shiftKpis.offlineLoomsCount,
      average_efficiency: shiftKpis.averageEfficiency,
      looms: loomList,
    },
    shiftKpis,
    systemStatus,
    loading: false,
    error: null,
  };
};
