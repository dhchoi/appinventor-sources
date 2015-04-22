/**
 * @license
 * @fileoverview Visual blocks editor for App Inventor
 * Methods to handle undos in the block editor.
 *
 * @author andy.dh.choi@gmail.com (Andy DongHyun Choi)
 */

/**
 * TODO:
 *  - save connections
 */

'use strict';

goog.provide('Blockly.UndoHandler');

Blockly.UndoHandler.savedStates = [];

Blockly.UndoHandler.saveState = function(block, lastPosition){
    //console.dir(block);
    //console.log(lastPosition);

    /* (referred from Blockly.copy_() inside blockly.js) */
    var xmlBlock = Blockly.Xml.blockToDom_(block);
    //Blockly.Xml.deleteNext(xmlBlock);
    
    // Encode start position in XML.
    var xy = lastPosition ? lastPosition : block.getRelativeToSurfaceXY();
    xmlBlock.setAttribute('x', Blockly.RTL ? -xy.x : xy.x);
    xmlBlock.setAttribute('y', xy.y);
    
    Blockly.UndoHandler.savedStates.push(xmlBlock);
    Blockly.UndoHandler.notifyStateChange();
};

Blockly.UndoHandler.retrieveState = function () {
    if (Blockly.UndoHandler.savedStates.length > 0) {
        Blockly.mainWorkspace.paste(Blockly.UndoHandler.savedStates.pop());
        Blockly.UndoHandler.notifyStateChange();
    }
};

Blockly.UndoHandler.notifyStateChange = function () {
    console.dir(Blockly.UndoHandler.savedStates);
    Blockly.mainWorkspace.undoIndicator.updateUndoButton(Blockly.UndoHandler.savedStates.length);
};
