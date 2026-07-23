const { screen } = require('electron');

class WidgetController {
  constructor(window) {
    this.win = window;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.dragInterval = null;
    this.dockEdge = null; // 'left', 'right', 'top', 'bottom', or null
    this.dockDisplay = null; // Display configuration where docked
    this.isCollapsed = false;
    this.isAnimating = false;
    this.slideInterval = null;
    this.hideTimeout = null;
    this.snapThreshold = 20; // px
    this.visiblePixels = 30; // Width/height left on-screen when collapsed (generous size to ensure hover works)
    this.animDuration = 180; // ms
    this.animSteps = 10;
  }

  startDrag(clickX, clickY) {
    console.log(`[debug] WidgetController.startDrag: clickX=${clickX}, clickY=${clickY}`);
    if (this.isDragging) return;
    this.isDragging = true;
    this.dragOffset = { x: clickX, y: clickY };
    this.dockDisplay = null;

    // Immediately expand window if it was collapsed
    if (this.isCollapsed || this.isAnimating) {
      this.expand(true); // immediate expand without animation
    }

    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    // Follow cursor loop (~60fps)
    this.dragInterval = setInterval(() => {
      const cursor = screen.getCursorScreenPoint();
      let targetX = cursor.x - this.dragOffset.x;
      let targetY = cursor.y - this.dragOffset.y;

      const [winWidth, winHeight] = this.win.getSize();
      const display = screen.getDisplayNearestPoint(cursor);
      const area = display.workArea;

      // Horizontal snapping (Left or Right)
      if (targetX <= area.x || Math.abs(targetX - area.x) < this.snapThreshold) {
        targetX = area.x;
      } else if ((targetX + winWidth) >= (area.x + area.width) || Math.abs((targetX + winWidth) - (area.x + area.width)) < this.snapThreshold) {
        targetX = area.x + area.width - winWidth;
      }

      // Vertical snapping (Top or Bottom)
      if (targetY <= area.y || Math.abs(targetY - area.y) < this.snapThreshold) {
        targetY = area.y;
      } else if ((targetY + winHeight) >= (area.y + area.height) || Math.abs((targetY + winHeight) - (area.y + area.height)) < this.snapThreshold) {
        targetY = area.y + area.height - winHeight;
      }

      // Update window position if changed
      const [curX, curY] = this.win.getPosition();
      if (curX !== targetX || curY !== targetY) {
        this.win.setPosition(targetX, targetY, false);
      }

      // Force strict width (300px) during drag to combat OS Aero Snap stretching
      if (Math.abs(winWidth - 300) > 5) {
        this.win.setSize(300, winHeight, false);
      }
    }, 16);
  }

  // Stop window drag
  stopDrag() {
    if (!this.isDragging) return;
    this.isDragging = false;
    if (this.dragInterval) {
      clearInterval(this.dragInterval);
      this.dragInterval = null;
    }

    // Force resize to width 300px if it got stretched at the moment of release
    let [w, h] = this.win.getSize();
    if (Math.abs(w - 300) > 5) {
      this.win.setSize(300, h, false);
      w = 300;
    }

    // Determine current dock edge using snapThreshold tolerance so docking is reliably detected
    const [x, y] = this.win.getPosition();
    const display = screen.getDisplayNearestPoint({ x: x + w / 2, y: y + h / 2 });
    const area = display.workArea;
    const tolerance = this.snapThreshold; // Use 20px tolerance so snapping reliably triggers docking

    if (x <= area.x || Math.abs(x - area.x) <= tolerance) {
      this.dockEdge = 'left';
      this.dockDisplay = display;
    } else if ((x + w) >= (area.x + area.width) || Math.abs(x - (area.x + area.width - w)) <= tolerance) {
      this.dockEdge = 'right';
      this.dockDisplay = display;
    } else if (y <= area.y || Math.abs(y - area.y) <= tolerance) {
      this.dockEdge = 'top';
      this.dockDisplay = display;
    } else if ((y + h) >= (area.y + area.height) || Math.abs(y - (area.y + area.height - h)) <= tolerance) {
      this.dockEdge = 'bottom';
      this.dockDisplay = display;
    } else {
      this.dockEdge = null;
      this.dockDisplay = null;
    }

    console.log(`[debug] WidgetController.stopDrag: pos=[${x},${y}], size=[${w},${h}], dockEdge=${this.dockEdge}`);

    // Check if mouse is already outside window on drag stop, schedule auto-hide if so
    const cursor = screen.getCursorScreenPoint();
    const inWindow = (
      cursor.x >= x && cursor.x <= x + w &&
      cursor.y >= y && cursor.y <= y + h
    );
    if (!inWindow && this.dockEdge) {
      this.scheduleCollapse();
    }
  }

  handleMouseEnter() {
    console.log(`[debug] WidgetController.handleMouseEnter: isCollapsed=${this.isCollapsed}, isAnimating=${this.isAnimating}, dockEdge=${this.dockEdge}`);
    
    // Check if physical cursor is actually inside the window bounds
    const cursor = screen.getCursorScreenPoint();
    const [x, y] = this.win.getPosition();
    const [w, h] = this.win.getSize();
    const inWindow = (
      cursor.x >= x && cursor.x <= x + w &&
      cursor.y >= y && cursor.y <= y + h
    );

    // If mouseenter was triggered while cursor is actually outside non-collapsed window, ignore it
    if (!inWindow && !this.isCollapsed) {
      console.log(`[debug] WidgetController.handleMouseEnter ignored: cursor is actually outside window`);
      return;
    }

    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    // Only expand if collapsed and not currently animating collapse
    if (this.isCollapsed && !this.isAnimating) {
      this.expand();
    }
  }

  handleMouseLeave() {
    console.log(`[debug] WidgetController.handleMouseLeave: isDragging=${this.isDragging}, dockEdge=${this.dockEdge}`);
    if (this.isDragging) return;
    if (this.dockEdge) {
      this.scheduleCollapse();
    }
  }

  scheduleCollapse() {
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    console.log(`[debug] WidgetController.scheduleCollapse: starting 1000ms timer`);
    this.hideTimeout = setTimeout(() => {
      this.hideTimeout = null;
      // Double check physical cursor position before collapsing
      const cursor = screen.getCursorScreenPoint();
      const [x, y] = this.win.getPosition();
      const [w, h] = this.win.getSize();
      const inWindow = (
        cursor.x >= x && cursor.x <= x + w &&
        cursor.y >= y && cursor.y <= y + h
      );
      console.log(`[debug] WidgetController timer expired: inWindow=${inWindow}, dockEdge=${this.dockEdge}, isCollapsed=${this.isCollapsed}`);
      if (!inWindow && this.dockEdge && !this.isCollapsed) {
        this.collapse();
      }
    }, 1000);
  }

  // Slide window out of view
  collapse() {
    if (!this.dockEdge || this.isCollapsed || this.isAnimating) return;
    this.isAnimating = true;

    const [x, y] = this.win.getPosition();
    const [w, h] = this.win.getSize();
    const display = this.dockDisplay || screen.getDisplayNearestPoint({ x: x + w / 2, y: y + h / 2 });
    const area = display.workArea;

    let startX = x, startY = y;
    let endX = x, endY = y;

    if (this.dockEdge === 'left') {
      endX = area.x - w + this.visiblePixels;
    } else if (this.dockEdge === 'right') {
      endX = area.x + area.width - this.visiblePixels;
    } else if (this.dockEdge === 'top') {
      endY = area.y - h + this.visiblePixels;
    } else if (this.dockEdge === 'bottom') {
      endY = area.y + area.height - this.visiblePixels;
    }

    console.log(`[debug] WidgetController.collapse: edge=${this.dockEdge}, from=[${startX},${startY}] to=[${endX},${endY}]`);
    this.animateSlide(startX, startY, endX, endY, () => {
      this.isCollapsed = true;
      this.isAnimating = false;
    });
  }

  // Slide window back into view
  expand(immediate = false) {
    if ((!this.isCollapsed && !immediate) || (this.isAnimating && !immediate)) return;

    const [x, y] = this.win.getPosition();
    const [w, h] = this.win.getSize();
    const display = this.dockDisplay || screen.getDisplayNearestPoint({ x: x + w / 2, y: y + h / 2 });
    const area = display.workArea;

    let startX = x, startY = y;
    let endX = x, endY = y;

    if (this.dockEdge === 'left') {
      endX = area.x;
    } else if (this.dockEdge === 'right') {
      endX = area.x + area.width - w;
    } else if (this.dockEdge === 'top') {
      endY = area.y;
    } else if (this.dockEdge === 'bottom') {
      endY = area.y + area.height - h;
    }

    console.log(`[debug] WidgetController.expand: immediate=${immediate}, edge=${this.dockEdge}, from=[${startX},${startY}] to=[${endX},${endY}]`);
    if (immediate) {
      if (this.slideInterval) {
        clearInterval(this.slideInterval);
        this.slideInterval = null;
      }
      this.isCollapsed = false;
      this.isAnimating = false;
      this.win.setPosition(endX, endY, false);
    } else {
      this.isAnimating = true;
      this.animateSlide(startX, startY, endX, endY, () => {
        this.isCollapsed = false;
        this.isAnimating = false;
      });
    }
  }

  // Control sliding animation using easeOutQuad
  animateSlide(startX, startY, endX, endY, onComplete) {
    if (this.slideInterval) {
      clearInterval(this.slideInterval);
    }

    let step = 0;
    const intervalMs = this.animDuration / this.animSteps;

    console.log(`[debug] WidgetController.animateSlide: start=[${startX},${startY}], end=[${endX},${endY}]`);
    this.slideInterval = setInterval(() => {
      step++;
      if (step >= this.animSteps) {
        clearInterval(this.slideInterval);
        this.slideInterval = null;
        this.win.setPosition(endX, endY, false);
        if (onComplete) onComplete();
        console.log(`[debug] WidgetController.animateSlide finished: pos=`, this.win.getPosition());
      } else {
        const t = step / this.animSteps;
        const ease = t * (2 - t); // easeOutQuad
        const curX = Math.round(startX + (endX - startX) * ease);
        const curY = Math.round(startY + (endY - startY) * ease);
        this.win.setPosition(curX, curY, false);
      }
    }, intervalMs);
  }
}

module.exports = WidgetController;
