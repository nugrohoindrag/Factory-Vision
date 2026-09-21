import React, { useEffect, useState } from 'react';
import { DEFAULT_SITE_CONFIG, getSiteConfig } from '../site-config';

const MESSAGE = 'Halo tim Factory Vision, saya ingin bertanya tentang Factory Vision.';

/**
 * The floating "Ask our Team" button, bottom-right on every landing view.
 *
 * Number and label come from the internal console (Pengaturan Situs) and
 * fall back to the defaults until the API answers, so the button is there
 * on first paint. wa.me opens the app on a phone and WhatsApp Web on a
 * desktop, with the greeting pre-filled.
 */
export const WhatsAppButton: React.FC = () => {
  const [number, setNumber] = useState(DEFAULT_SITE_CONFIG.whatsappNumber);
  const [label, setLabel] = useState(DEFAULT_SITE_CONFIG.whatsappLabel);

  useEffect(() => {
    let live = true;
    void getSiteConfig().then((cfg) => {
      if (!live) return;
      setNumber(cfg.whatsappNumber);
      setLabel(cfg.whatsappLabel || DEFAULT_SITE_CONFIG.whatsappLabel);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!number) return null;

  return (
    <a
      className="fv-whatsapp"
      href={`https://wa.me/${number}?text=${encodeURIComponent(MESSAGE)}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} via WhatsApp`}
    >
      {/* WhatsApp's mark is a brand logo, not one of our Material Symbols. */}
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.2-.3-.3-.6-.4zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z" />
      </svg>
      <span className="fv-whatsapp__label">{label}</span>
    </a>
  );
};
