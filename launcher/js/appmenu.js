/* ============================================================
   appmenu.js — Apple TV's small menu when you hold OK on an app,
   and the confirmation box ("Delete “X”?").

   APL.contextMenu.open(tileEl, [{ label, icon, destructive, run }])
   APL.alert({ title, message, buttons: [{ label, destructive, run }], focus })
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL;

    function el(tag, cls) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        return e;
    }

    /* ---------- context menu ---------- */
    var menuRoot, menuPanel, menuNav, menuItems = [], menuOpen = false;

    function buildMenu() {
        menuRoot = el("div", "appmenu");
        menuPanel = el("div", "appmenu__panel");
        menuRoot.appendChild(menuPanel);
        document.body.appendChild(menuRoot);
        menuNav = new APL.Nav({
            onSelect: function (i) {
                var item = menuItems[i];
                closeMenu();
                if (item && item.run) item.run();
            },
            onBack: closeMenu
        });
    }

    function openMenu(anchor, items) {
        if (!menuRoot) buildMenu();
        menuItems = items;
        menuPanel.innerHTML = "";
        var rows = items.map(function (it) {
            var row = el("div", "appmenu__item" + (it.destructive ? " is-destructive" : ""));
            var label = el("span", "appmenu__label");
            label.textContent = it.label;
            row.appendChild(label);
            var ico = el("span", "appmenu__icon");
            ico.innerHTML = APL.icon(it.icon || "info", 34, 1.9);
            row.appendChild(ico);
            menuPanel.appendChild(row);
            return row;
        });

        // Below the icon if there is room, otherwise above it (as on tvOS).
        menuRoot.classList.remove("is-open", "is-above");
        menuRoot.style.visibility = "hidden";
        menuRoot.style.display = "block";
        // Position in the 1920×1080 screen (the PC preview shrinks it: scale back).
        var a = anchor.getBoundingClientRect(), o = document.body.getBoundingClientRect();
        var k = (o.width / (document.body.offsetWidth || o.width)) || 1;
        var r = { left: (a.left - o.left) / k, top: (a.top - o.top) / k, bottom: (a.bottom - o.top) / k };
        var w = menuPanel.offsetWidth, h = menuPanel.offsetHeight;
        var top = r.bottom + 26, above = false;
        if (top + h > 1040) { top = r.top - 26 - h; above = true; }
        var left = Math.max(60, Math.min(1920 - 60 - w, r.left));
        menuPanel.style.left = Math.round(left) + "px";
        menuPanel.style.top = Math.round(Math.max(40, top)) + "px";
        menuRoot.classList.toggle("is-above", above);
        menuRoot.style.visibility = "";
        void menuRoot.offsetWidth;
        menuRoot.classList.add("is-open");

        menuNav.setTiles(rows);
        menuNav.focus(0);
        APL.pushNav(menuNav);
        menuOpen = true;
    }

    function closeMenu() {
        if (!menuOpen) return;
        menuOpen = false;
        menuRoot.classList.remove("is-open");
        APL.popNav(menuNav);
        setTimeout(function () { if (!menuOpen) menuRoot.style.display = "none"; }, 220);
    }

    /* ---------- confirmation box (tvOS alert) ---------- */
    var alertRoot, alertTitle, alertMsg, alertExtra, alertBtns, alertNav, alertSpec = null;

    function buildAlert() {
        alertRoot = el("div", "aplalert");
        var box = el("div", "aplalert__box");
        alertTitle = el("h2", "aplalert__title");
        alertMsg = el("p", "aplalert__msg");
        alertExtra = el("div", "aplalert__extra");              // spec.node: a picture under the message (a QR code)
        alertBtns = el("div", "aplalert__buttons");
        box.appendChild(alertTitle); box.appendChild(alertMsg); box.appendChild(alertExtra); box.appendChild(alertBtns);
        alertRoot.appendChild(box);
        document.body.appendChild(alertRoot);
        alertNav = new APL.Nav({
            onSelect: function (i) {
                var b = alertSpec && alertSpec.buttons[i];
                closeAlert();
                if (b && b.run) b.run();
            },
            onBack: closeAlert
        });
    }

    function openAlert(spec) {
        if (!alertRoot) buildAlert();
        alertSpec = spec;
        alertTitle.textContent = spec.title || "";
        alertMsg.textContent = spec.message || "";
        alertMsg.style.display = spec.message ? "" : "none";
        alertExtra.innerHTML = "";
        if (spec.node) alertExtra.appendChild(spec.node);
        alertExtra.style.display = spec.node ? "" : "none";
        alertBtns.innerHTML = "";
        var btns = spec.buttons.map(function (b) {
            var e = el("div", "aplalert__btn" + (b.destructive ? " is-destructive" : ""));
            e.textContent = b.label;
            alertBtns.appendChild(e);
            return e;
        });
        alertRoot.classList.add("is-open");
        alertNav.setTiles(btns);
        alertNav.focus(spec.focus || 0);
        APL.pushNav(alertNav);
    }

    function closeAlert() {
        if (!alertSpec) return;
        alertSpec = null;
        alertRoot.classList.remove("is-open");
        APL.popNav(alertNav);
    }

    APL.contextMenu = { open: openMenu, close: closeMenu, isOpen: function () { return menuOpen; } };
    APL.alert = openAlert;
    APL.alert.close = closeAlert;
    APL.alert.isOpen = function () { return !!alertSpec; };
})(window);
