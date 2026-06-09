import { getAppVersionLabel } from '../lib/app-version';

export function BuildLabel(): JSX.Element {
  return <p className="build-label muted-text">Build {getAppVersionLabel()}</p>;
}
