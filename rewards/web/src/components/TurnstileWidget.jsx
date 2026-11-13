'use client';

import { useEffect, useRef } from 'react';

export default function TurnstileWidget({ onVerify, onError, className = '' }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);

  const siteKey =
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';

  useEffect(() => {
    let isMounted = true;

    function renderWidget() {
      if (!isMounted || !containerRef.current || !window.turnstile) return;

      if (widgetIdRef.current !== null) {
        try {
          window.turnstile.reset(widgetIdRef.current);
          return;
        } catch (e) {
          // ignore
        }
      }

      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'dark',
          callback: (token) => {
            if (isMounted && onVerify) onVerify(token);
          },
          'error-callback': () => {
            if (isMounted && onError) onError();
          },
          'expired-callback': () => {
            if (isMounted && onVerify) onVerify('');
          },
        });
      } catch (err) {
        console.warn('Turnstile render error:', err);
      }
    }

    // Check if Cloudflare Turnstile script is already present
    if (!window.turnstile) {
      const scriptId = 'cf-turnstile-script';
      if (!document.getElementById(scriptId)) {
        const script = document.createElement('script');
        script.id = scriptId;
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.onload = () => {
          setTimeout(renderWidget, 100);
        };
        document.body.appendChild(script);
      } else {
        const interval = setInterval(() => {
          if (window.turnstile) {
            clearInterval(interval);
            renderWidget();
          }
        }, 150);
        return () => clearInterval(interval);
      }
    } else {
      renderWidget();
    }

    return () => {
      isMounted = false;
      if (widgetIdRef.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch (e) {}
        widgetIdRef.current = null;
      }
    };
  }, [siteKey]);

  return (
    <div className={`turnstile-wrapper flex justify-center my-3 ${className}`}>
      <div ref={containerRef} />
    </div>
  );
}
