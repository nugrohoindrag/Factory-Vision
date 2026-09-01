import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { FactoryVisionLogo } from '@factory-vision/ui/fv';
import { Icon } from '@factory-vision/ui';
export const Navbar = ({ onOpenDemo }) => {
    const [theme, setTheme] = useState('light');
    const [scrolled, setScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 15);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);
    const toggleTheme = () => {
        const nextTheme = theme === 'light' ? 'dark' : 'light';
        setTheme(nextTheme);
        document.documentElement.setAttribute('data-theme', nextTheme);
    };
    const navLinks = [
        { label: 'Overview', href: '#overview' },
        { label: 'Modules', href: '#modules' },
        { label: 'Shopfloor', href: '#shopfloor' },
        { label: 'OEE & Analytics', href: '#oee' },
        { label: 'Showcase', href: '#showcase' },
        { label: 'Deployment', href: '#deployment' },
    ];
    return (_jsxs("header", { style: {
            position: 'sticky',
            top: 0,
            zIndex: 100,
            width: '100%',
            backgroundColor: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-outline-variant)',
            boxShadow: scrolled
                ? 'var(--elevation-2)'
                : 'var(--elevation-1)',
            backdropFilter: 'blur(12px)',
            transition: 'all 0.25s ease',
        }, children: [_jsxs("div", { className: "fv-landing-container", style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    height: '76px',
                }, children: [_jsx("a", { href: "#", style: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-3)',
                            textDecoration: 'none',
                            color: 'var(--color-on-surface)',
                        }, children: _jsx(FactoryVisionLogo, { size: "md", variant: "full", tagline: "Manufacturing Execution System" }) }), _jsx("nav", { style: {
                            display: 'none',
                            alignItems: 'center',
                            gap: 'var(--space-8)',
                        }, className: "fv-desktop-nav", children: navLinks.map((link) => (_jsx("a", { href: link.href, style: {
                                fontSize: '14px',
                                fontWeight: 600,
                                color: 'var(--color-on-surface-variant)',
                                textDecoration: 'none',
                                transition: 'color 0.15s ease',
                            }, onMouseEnter: (e) => {
                                e.currentTarget.style.color = 'var(--color-primary)';
                            }, onMouseLeave: (e) => {
                                e.currentTarget.style.color = 'var(--color-on-surface-variant)';
                            }, children: link.label }, link.label))) }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }, children: [_jsx("button", { onClick: toggleTheme, "aria-label": "Toggle Theme", style: {
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '9999px',
                                    border: '1px solid var(--color-outline-variant)',
                                    backgroundColor: 'var(--color-surface)',
                                    color: 'var(--color-primary)',
                                    cursor: 'pointer',
                                    boxShadow: 'var(--elevation-1)',
                                    transition: 'all 0.15s ease',
                                }, children: _jsx(Icon, { name: theme === 'light' ? 'dark_mode' : 'light_mode', size: 18 }) }), _jsxs("button", { onClick: onOpenDemo, className: "fv-btn-primary", style: {
                                    padding: `var(--space-3) var(--space-6)`,
                                    fontSize: '14px',
                                }, children: ["Book a Demo", _jsx(Icon, { name: "arrow_forward", size: 16 })] }), _jsx("button", { onClick: () => setMobileMenuOpen(!mobileMenuOpen), className: "fv-mobile-toggle", "aria-label": "Toggle Menu", style: {
                                    display: 'none',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '10px',
                                    border: '1px solid var(--color-outline-variant)',
                                    backgroundColor: 'var(--color-surface)',
                                    color: 'var(--color-on-surface)',
                                    cursor: 'pointer',
                                }, children: _jsx(Icon, { name: mobileMenuOpen ? 'close' : 'menu', size: 20 }) })] })] }), mobileMenuOpen && (_jsx("div", { style: {
                    backgroundColor: 'var(--color-surface)',
                    borderBottom: '1px solid var(--color-outline-variant)',
                    padding: `var(--space-4) var(--space-6)`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-3)',
                    boxShadow: 'var(--elevation-2)',
                }, children: navLinks.map((link) => (_jsx("a", { href: link.href, onClick: () => setMobileMenuOpen(false), style: {
                        fontSize: '15px',
                        fontWeight: 600,
                        color: 'var(--color-on-surface)',
                        textDecoration: 'none',
                        padding: `var(--space-2) 0`,
                    }, children: link.label }, link.label))) })), _jsx("style", { children: `
        @media (min-width: 860px) {
          .fv-desktop-nav {
            display: flex !important;
          }
        }
        @media (max-width: 859px) {
          .fv-mobile-toggle {
            display: flex !important;
          }
        }
      ` })] }));
};
//# sourceMappingURL=Navbar.js.map