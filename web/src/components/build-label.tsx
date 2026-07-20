import { useState } from 'react';
import { AboutDialog } from './about-dialog';
import { getAppBuildLabel, getAppVersionLabel } from '../lib/app-version';
import { PRODUCT_INFO } from '../lib/product-info';

export function BuildLabel(): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="build-label-button muted-text" onClick={() => setOpen(true)}>
        <span className="build-label-product">{PRODUCT_INFO.productName}</span>
        <span>Version {getAppVersionLabel()}</span>
        <span>Build {getAppBuildLabel()}</span>
      </button>
      <AboutDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
