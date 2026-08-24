import { Toast } from './components/Layout.js';
import { HomeScreen } from './screens/Home.js';
import { LoginScreen } from './screens/Login.js';
import { NewFaceLogScreen } from './screens/NewFaceLog.js';
import { OffsetWorkflowScreen } from './screens/OffsetWorkflow.js';
import { HazardScreen, ObservationScreen, PhotoScreen, SampleScreen } from './screens/Capture.js';
import { FaceLogScreen, MyLogsScreen, PendingSyncScreen, SettingsScreen } from './screens/Records.js';
import { useApp } from './state/app.js';

export function App() {
  const { session, ready, route } = useApp();

  if (!ready) {
    return (
      <div className="app">
        <div className="screen" style={{ justifyContent: 'center', textAlign: 'center' }}>
          <div className="header-title">UNKI GEOTECH</div>
        </div>
      </div>
    );
  }

  if (!session) return <LoginScreen />;

  return (
    <div className="app">
      {route.name === 'home' && <HomeScreen />}
      {route.name === 'newFaceLog' && <NewFaceLogScreen />}
      {route.name === 'faceLog' && <FaceLogScreen localId={route.localId} />}
      {route.name === 'offset' && <OffsetWorkflowScreen faceLogLocalId={route.faceLogLocalId} />}
      {route.name === 'observation' && <ObservationScreen faceLogLocalId={route.faceLogLocalId} />}
      {route.name === 'sample' && <SampleScreen faceLogLocalId={route.faceLogLocalId} />}
      {route.name === 'hazard' && <HazardScreen faceLogLocalId={route.faceLogLocalId} />}
      {route.name === 'photo' && <PhotoScreen faceLogLocalId={route.faceLogLocalId} />}
      {route.name === 'myLogs' && <MyLogsScreen />}
      {route.name === 'pending' && <PendingSyncScreen />}
      {route.name === 'settings' && <SettingsScreen />}
      <Toast />
    </div>
  );
}
