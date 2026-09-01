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
            backgroundColor: '#FFFFFF',
            borderBottom: '1px solid #E2E8F0',
            boxShadow: scrolled
                ? '0 4px 20px rgba(0, 29, 57, 0.08)'
                : '0 2px 8px rgba(0, 29, 57, 0.03)',
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
                            gap: '12px',
                            textDecoration: 'none',
                            color: '#001D39',
                        }, children: _jsx(FactoryVisionLogo, { size: "md", variant: "full", tagline: "Manufacturing Execution System" }) }), _jsx("nav", { style: {
                            display: 'none',
                            alignItems: 'center',
                            gap: '28px',
                        }, className: "fv-desktop-nav", children: navLinks.map((link) => (_jsx("a", { href: link.href, style: {
                                fontSize: '14px',
                                fontWeight: 600,
                                color: '#334155',
                                textDecoration: 'none',
                                transition: 'color 0.15s ease',
                            }, onMouseEnter: (e) => {
                                e.currentTarget.style.color = '#0A4174';
                            }, onMouseLeave: (e) => {
                                e.currentTarget.style.color = '#334155';
                            }, children: link.label }, link.label))) }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '14px' }, children: [_jsx("button", { onClick: toggleTheme, "aria-label": "Toggle Theme", style: {
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '9999px',
                                    border: '1px solid #CBD5E1',
                                    backgroundColor: '#FFFFFF',
                                    color: '#0A4174',
                                    cursor: 'pointer',
                                    boxShadow: '0 2px 6px rgba(0, 29, 57, 0.04)',
                                    transition: 'all 0.15s ease',
                                }, children: _jsx(Icon, { name: theme === 'light' ? 'dark_mode' : 'light_mode', size: 18 }) }), _jsxs("button", { onClick: onOpenDemo, className: "fv-btn-primary", style: {
                                    padding: '10px 22px',
                                    fontSize: '14px',
                                }, children: ["Book a Demo", _jsx(Icon, { name: "arrow_forward", size: 16 })] }), _jsx("button", { onClick: () => setMobileMenuOpen(!mobileMenuOpen), className: "fv-mobile-toggle", "aria-label": "Toggle Menu", style: {
                                    display: 'none',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '10px',
                                    border: '1px solid #CBD5E1',
                                    backgroundColor: '#FFFFFF',
                                    color: '#001D39',
                                    cursor: 'pointer',
                                }, children: _jsx(Icon, { name: mobileMenuOpen ? 'close' : 'menu', size: 20 }) })] })] }), mobileMenuOpen && (_jsx("div", { style: {
                    backgroundColor: '#FFFFFF',
                    borderBottom: '1px solid #E2E8F0',
                    padding: '16px 24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    boxShadow: '0 8px 24px rgba(0, 29, 57, 0.08)',
                }, children: navLinks.map((link) => (_jsx("a", { href: link.href, onClick: () => setMobileMenuOpen(false), style: {
                        fontSize: '15px',
                        fontWeight: 600,
                        color: '#001D39',
                        textDecoration: 'none',
                        padding: '8px 0',
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