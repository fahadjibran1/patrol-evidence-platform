import { useState } from 'react';
import { getAppBuildLabel, getAppVersionLabel } from '../lib/app-version';
import { PRODUCT_INFO } from '../lib/product-info';

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  if (!open) {
    return null;
  }

  return (
    <div className="lightbox-backdrop" role="dialog" aria-modal="true" aria-label="About Patrol Evidence Platform" onClick={onClose}>
      <div className="lightbox-panel about-dialog-panel" onClick={(event) => event.stopPropagation()}>
        <header className="lightbox-header">
          <div>
            <h3>{PRODUCT_INFO.productName}</h3>
            <p className="muted-text">Product information</p>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </header>

        <dl className="about-dialog-meta">
          <div>
            <dt>Product</dt>
            <dd>{PRODUCT_INFO.productName}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>Version {getAppVersionLabel()}</dd>
          </div>
          <div>
            <dt>Build</dt>
            <dd>{getAppBuildLabel()}</dd>
          </div>
          <div>
            <dt>Company</dt>
            <dd>{PRODUCT_INFO.companyName}</dd>
          </div>
          <div>
            <dt>Copyright</dt>
            <dd>{PRODUCT_INFO.copyright}</dd>
          </div>
          <div>
            <dt>Support</dt>
            <dd>
              <a href={`mailto:${PRODUCT_INFO.supportEmail}`}>{PRODUCT_INFO.supportEmail}</a>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export function AboutButton(): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="secondary-button" onClick={() => setOpen(true)}>
        About
      </button>
      <AboutDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
