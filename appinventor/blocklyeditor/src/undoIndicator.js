/**
 * @license
 * @fileoverview Visual blocks editor for App Inventor
 * Methods to handle undos in the block editor.
 *
 * @author andy.dh.choi@gmail.com (Andy Choi)
 */

'use strict';

goog.provide('Blockly.UndoIndicator');

goog.require('Blockly.UndoHandler');


/**
 * Class for a undo indicator.
 * @param {!Function} getMetrics A function that returns workspace's metrics.
 * @constructor
 */
Blockly.UndoIndicator = function(workspace) {
    this.workspace_ = workspace;
};

/**
 * Height of the undo indicator.
 * @type {number}
 * @private
 */
Blockly.UndoIndicator.prototype.INDICATOR_HEIGHT_ = 40;

/**
 * Distance between undo indicator and bottom edge of workspace.
 * @type {number}
 * @private
 *///
Blockly.UndoIndicator.prototype.MARGIN_BOTTOM_ = 35;

/**
 * Distance between undo indicator and right edge of workspace.
 * @type {number}
 * @private
 */
Blockly.UndoIndicator.prototype.MARGIN_SIDE_ = 35;

/**
 * The SVG group containing the undo indicator.
 * @type {Element}
 * @private
 */
Blockly.UndoIndicator.prototype.svgGroup_ = null;

/**
 * Left coordinate of the undo indicator.
 * @type {number}
 * @private
 */
Blockly.UndoIndicator.prototype.left_ = 0;

/**
 * Top coordinate of the undo indicator.
 * @type {number}
 * @private
 */
Blockly.UndoIndicator.prototype.top_ = 0;

/**
 * Create the undo indicator elements.
 * @return {!Element} The warning indicator's SVG group.
 */
Blockly.UndoIndicator.prototype.createDom = function() {
    this.svgGroup_ = Blockly.createSvgElement('g', {}, null);
    
    this.undoToggle_ = Blockly.createSvgElement('rect',
        {'fill': "#eeeeee",'width':"120", 'height':"20", 'x':"125",'y':"20",'style':"stroke:black;stroke-width:1;cursor:pointer;"},
        this.svgGroup_);
    this.undoToggleText_ = Blockly.createSvgElement('text',
        {'fill': "black", 'transform':"translate(185,35)",'text-anchor':"middle",'style':"font-size:10pt;cursor:pointer;"},
        this.svgGroup_);
    this.undoToggleText_.textContent = "Undo (0)"; //Blockly.Msg.SHOW_WARNINGS;

    return this.svgGroup_;
};

/**
 * Initialize the warning indicator.
 */
Blockly.UndoIndicator.prototype.init = function() {
    this.position_();
    // If the document resizes, reposition the warning indicator.
    Blockly.bindEvent_(window, 'resize', this, this.position_);
    Blockly.bindEvent_(this.undoToggle_, 'mouseup', this, Blockly.UndoIndicator.prototype.onclickUndoToggle);
    Blockly.bindEvent_(this.undoToggleText_, 'mouseup', this, Blockly.UndoIndicator.prototype.onclickUndoToggle);
};

/**
 * Dispose of this undo indicator.
 * Unlink from all DOM elements to prevent memory leaks.
 */
Blockly.UndoIndicator.prototype.dispose = function() {
    if (this.svgGroup_) {
        goog.dom.removeNode(this.svgGroup_);
        this.svgGroup_ = null;
    }

    this.getMetrics_ = null;

    this.undoToggle_ = null;
    this.undoToggleText_ = null;
};

/**
 * Move the undo indicator to the bottom-left corner.
 * @private
 */
Blockly.UndoIndicator.prototype.position_ = function() {
    var metrics = this.workspace_.getMetrics();
    if (!metrics) {
        // There are no metrics available (workspace is probably not visible).
        return;
    }
    if (Blockly.RTL) {
        this.left_ = this.MARGIN_SIDE_;
    } else {
        this.left_ = metrics.absoluteLeft + this.MARGIN_SIDE_;
    }
    this.top_ = metrics.viewHeight + metrics.absoluteTop - (this.INDICATOR_HEIGHT_) - this.MARGIN_BOTTOM_;
    this.svgGroup_.setAttribute('transform', 'translate(' + this.left_ + ',' + this.top_ + ')');
};


/**
 * Change the undo button to indicate whether it can perform actions or not.
 */
Blockly.UndoIndicator.prototype.updateUndoIndicator = function(numSavedStates) {
    if(numSavedStates > 0) {
        this.undoToggleText_.textContent = "Undo (" + numSavedStates + ")"; //Blockly.Msg.HIDE_WARNINGS;
    }
    else {
        this.undoToggleText_.textContent = "Undo (0)"; //Blockly.Msg.SHOW_WARNINGS;
    }
};

/**
 * Call to undo any actions.
 */
Blockly.UndoIndicator.prototype.onclickUndoToggle = function() {
    Blockly.UndoHandler.retrieveRecord();
};
