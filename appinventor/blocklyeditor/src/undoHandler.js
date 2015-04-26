/**
 * @license
 * @fileoverview Visual blocks editor for App Inventor
 * Methods to handle undos in the block editor.
 *
 * @author andy.dh.choi@gmail.com (Andy Choi)
 */

/**
 * TODO:
 * [Required]
 *  - change hardcoded strings to MSGs and enums
 *  - refactor variable and method names
 *  - implement for disconnections in case of healStack when DELETED_BY_KEY
 *  - fix when connecting into middle (if undo is done, then the bottom should connect back to top)
 *  - redo
 *
 *  [Potential]
 *  - implement for block collapse/disable/add_comment changes (context menu orders)?
 *  - implement for block mutations?
 *  - there is a bug? where deleted blocks still remain in workspace (that is why id is incremented for revived blocks)
 *  - not tested for Blockly.Realtime environments (don't know what that is)
 */

'use strict';

goog.provide('Blockly.UndoHandler');

Blockly.UndoHandler.MAX_NUM_SAVED_STATES = 20;

Blockly.UndoHandler.STATE_TYPE_CREATED = "STATE_TYPE_CREATED";
Blockly.UndoHandler.STATE_TYPE_MOVED = "STATE_TYPE_MOVED";
Blockly.UndoHandler.STATE_TYPE_CONNECTED = "STATE_TYPE_CONNECTED";
Blockly.UndoHandler.STATE_TYPE_DISCONNECTED = "STATE_TYPE_DISCONNECTED";
Blockly.UndoHandler.STATE_TYPE_DELETED = "STATE_TYPE_DELETED";

Blockly.UndoHandler.DELETED_BY_KEY = "DELETED_BY_KEY";
Blockly.UndoHandler.DELETED_BY_MOUSE = "DELETED_BY_MOUSE";

Blockly.UndoHandler.savedState = {};
Blockly.UndoHandler.savedStates = [];
Blockly.UndoHandler.isRecording = false;

Blockly.UndoHandler.retrieveState = function () {
    if (Blockly.UndoHandler.savedStates.length > 0) {
        var mostRecentState = Blockly.UndoHandler.savedStates.pop();
        var mostRecentStateBlock = mostRecentState.BLOCK;
        
        // STATE CHANGE TYPE: deleted -> revive what was deleted
        if(mostRecentState.hasOwnProperty(Blockly.UndoHandler.STATE_TYPE_DELETED)) {
            var deletedXmlBlock = mostRecentState[Blockly.UndoHandler.STATE_TYPE_DELETED].xmlBlock;
            Blockly.mainWorkspace.paste(deletedXmlBlock);
            mostRecentStateBlock = Blockly.selected;
        
            // remap ids since they've changed if deleted and revived back
            var deletedIds = mostRecentState[Blockly.UndoHandler.STATE_TYPE_DELETED].deletedIds;
            var revivedIds = Blockly.UndoHandler.getIdsForDescendants(mostRecentStateBlock);
            for(var i = 0; i < deletedIds.length; i++) {
                Blockly.UndoHandler.remapDeletedBlockToRevivedBlock(deletedIds[i], revivedIds[i]);
            }
        }
        
        // STATE CHANGE TYPE: connected -> disconnect what was connected
        if(mostRecentState.hasOwnProperty(Blockly.UndoHandler.STATE_TYPE_CONNECTED)) {
            var connectedConnectionIndices = mostRecentState[Blockly.UndoHandler.STATE_TYPE_CONNECTED];
            for(var i = 0; i < connectedConnectionIndices.length; i++) {
                var connection = mostRecentStateBlock.getConnections_()[connectedConnectionIndices[i]];
                if(connection.isSuperior()) {
                    connection.targetConnection.sourceBlock_.unplug();
                }
                else {
                    connection.sourceBlock_.unplug();
                }
            }
        }
        
        // STATE CHANGE TYPE: moved -> move back to last position
        if(mostRecentState.hasOwnProperty(Blockly.UndoHandler.STATE_TYPE_MOVED)) {
            var lastPosition = mostRecentState[Blockly.UndoHandler.STATE_TYPE_MOVED];
            mostRecentStateBlock.moveTo(lastPosition.x, lastPosition.y);
        }
        
        // STATE CHANGE TYPE: disconnected -> connect what was disconnected
        if(mostRecentState.hasOwnProperty(Blockly.UndoHandler.STATE_TYPE_DISCONNECTED)) {
            var disconnectedBlocksRecords = mostRecentState[Blockly.UndoHandler.STATE_TYPE_DISCONNECTED];
            for(var i = 0; i < disconnectedBlocksRecords.length; i++) {
                var disconnectedBlockRecord = disconnectedBlocksRecords[i];
                var disconnectedBlock = disconnectedBlockRecord.disconnectedBlock;
                var disconnectedBlocksConnectionToBlockIndex = disconnectedBlockRecord.disconnectedBlocksConnectionToBlockIndex;
                var blocksConnectionToDisconnectedBlockIndex = disconnectedBlockRecord.blocksConnectionToDisconnectedBlockIndex;
                // only connect if disconnectedBlock didn't connect to something in the meanwhile (e.g. healStack) 
                if(disconnectedBlock.getConnections_()[disconnectedBlocksConnectionToBlockIndex].targetConnection == null) {
                    disconnectedBlock.getConnections_()[disconnectedBlocksConnectionToBlockIndex].connect(mostRecentStateBlock.getConnections_()[blocksConnectionToDisconnectedBlockIndex]);
                }
            }
        }

        if(mostRecentState.hasOwnProperty(Blockly.UndoHandler.STATE_TYPE_CREATED)) {
            mostRecentStateBlock.dispose(false, false);
        }
        
        // notify state change to undoIndicator
        Blockly.UndoHandler.notifyStateChange();
    }
};

Blockly.UndoHandler.notifyStateChange = function () {
    Blockly.mainWorkspace.undoIndicator.updateUndoIndicator(Blockly.UndoHandler.savedStates.length);
};

Blockly.UndoHandler.clearSavedStates = function () {
    Blockly.UndoHandler.savedStates.length = 0;
    Blockly.mainWorkspace.undoIndicator.updateUndoIndicator(Blockly.UndoHandler.savedStates.length);
};

Blockly.UndoHandler.remapDeletedBlockToRevivedBlock = function(deletedId, revivedId) {
    for(var i = 0; i < Blockly.UndoHandler.savedStates.length; i++) {
        var savedState = Blockly.UndoHandler.savedStates[i];
        if(savedState.BLOCK && savedState.BLOCK.id == deletedId) {
            savedState.BLOCK = Blockly.mainWorkspace.getBlockById(revivedId);
        }
        if(savedState[Blockly.UndoHandler.STATE_TYPE_DISCONNECTED]) {
            var disconnectedBlocksRecords = savedState[Blockly.UndoHandler.STATE_TYPE_DISCONNECTED];
            for (var j = 0; j < disconnectedBlocksRecords.length; j++) {
                if (disconnectedBlocksRecords[j].disconnectedBlock.id == deletedId) {
                    disconnectedBlocksRecords[j].disconnectedBlock = Blockly.mainWorkspace.getBlockById(revivedId);
                }
            }
        }
    }
};

// created own function, since order of getDescendants() differs depending on block connection order
// this will always return fixed order of a block structure's descendants, regardless of in what order the blocks were connected 
Blockly.UndoHandler.getIdsForDescendants = function(block) {
    var idsForDescendants = [block.id];
    var blockIds = [block.id];
    
    while(blockIds.length > 0) {
        var nextBlockId = blockIds.pop();
        var nextBlock = Blockly.mainWorkspace.getBlockById(nextBlockId);
        var nextBlockConnections = nextBlock.getConnections_();
        for(var i = 0; i < nextBlockConnections.length; i++) {
            if(nextBlockConnections[i].targetConnection != null) {
                var targetBlock = nextBlockConnections[i].targetConnection.sourceBlock_;
                if(idsForDescendants.indexOf(targetBlock.id) < 0) {
                    idsForDescendants.push(targetBlock.id);
                    blockIds.push(targetBlock.id);
                }
            }
        }
    }
    
    return idsForDescendants;
};

Blockly.UndoHandler.createDeletedBlockRecord = function(deletionType) {
    var block = Blockly.UndoHandler.savedState.BLOCK;
    var xmlBlock = Blockly.Xml.blockToDom_(block);
    var deletedIds = Blockly.UndoHandler.getIdsForDescendants(block);

    // if it was dragged, all other horizontal children were dragged with it, so don't do deleteNext
    // if it was deleted with the del key, horizontal children weren't deleted, so do deleteNext
    if(deletionType == Blockly.UndoHandler.DELETED_BY_KEY) {
        // if there were nextBlocks, those ids should be removed from deletedIds
        if(block.getNextBlock()) {
            var idsForNextBlockDescendants = Blockly.UndoHandler.getIdsForDescendants(block.getNextBlock());
            for(var i = 0; i < idsForNextBlockDescendants.length; i ++) {
                if(deletedIds.indexOf(idsForNextBlockDescendants[i]) > -1) {
                    deletedIds.splice(deletedIds.indexOf(idsForNextBlockDescendants[i]), 1);
                }
            }
        }
        // delete the next blocks from the XML representation too 
        Blockly.Xml.deleteNext(xmlBlock);
    }

    // set position
    var xy = block.getRelativeToSurfaceXY();
    xmlBlock.setAttribute('x', Blockly.RTL ? -xy.x : xy.x);
    xmlBlock.setAttribute('y', xy.y);

    return {xmlBlock: xmlBlock, deletedIds: deletedIds};
};

Blockly.UndoHandler.createMovedBlockRecord = function () {
    return {x: Blockly.UndoHandler.savedState.BLOCK.startDragX, y: Blockly.UndoHandler.savedState.BLOCK.startDragY}    
};

Blockly.UndoHandler.createConnectedBlockRecord = function(previousConnectedConnections) {
    // check what new connected connections the block has made
    var newConnectedConnectionsIndices = [];
    var block = Blockly.UndoHandler.savedState.BLOCK;
    
    var allConnections = block.getConnections_();
    for(var i = 0; i < allConnections.length; i++) {
      if(allConnections[i].targetConnection != null && previousConnectedConnections.indexOf(allConnections[i]) < 0) {
          newConnectedConnectionsIndices.push(i); // save only index, since connection will become outdated when deletion happens
      }
    }
    
    return newConnectedConnectionsIndices;
};

Blockly.UndoHandler.createDisconnectedBlockRecord = function(disconnectedBlocks) {
    var block = Blockly.UndoHandler.savedState.BLOCK;
    var disconnectedBlocksRecords = [];
    for(var i = 0; i < disconnectedBlocks.length; i ++) {
        var disconnectedBlock = disconnectedBlocks[i];
        disconnectedBlocksRecords.push({
            disconnectedBlock: disconnectedBlock,
            disconnectedBlocksConnectionToBlockIndex: Blockly.UndoHandler.getConnectionToTargetBlockIndex(disconnectedBlock, block),
            blocksConnectionToDisconnectedBlockIndex: Blockly.UndoHandler.getConnectionToTargetBlockIndex(block, disconnectedBlock)
        });
    }
    
    return disconnectedBlocksRecords;
};

Blockly.UndoHandler.getConnectionToTargetBlockIndex = function(sourceBlock, targetBlock) {
    var sourceBlockConnections = sourceBlock.getConnections_();
    for(var i = 0; i < sourceBlockConnections.length; i++) {
        if(sourceBlockConnections[i].targetConnection && (sourceBlockConnections[i].targetConnection.sourceBlock_ == targetBlock)) {
            return i;
        }
    }
};

Blockly.UndoHandler.startRecord = function(block) {
    // not going to save states for changes in other workspaces (e.g. mutator workspaces, etc.)
    if(block.workspace == Blockly.mainWorkspace && Blockly.UndoHandler.isRecording == false) {
        // reset savedState
        Blockly.UndoHandler.savedState = {};
        Blockly.UndoHandler.savedState.BLOCK = block;
        Blockly.UndoHandler.isRecording = true;
    }
};

Blockly.UndoHandler.addRecord = function(type, data) {
    if(Blockly.UndoHandler.isRecording) {
        // only add record if it was not recorded yet (preventing duplicates)
        if (!Blockly.UndoHandler.savedState.hasOwnProperty(type)) {
            if (type == Blockly.UndoHandler.STATE_TYPE_DELETED) {
                Blockly.UndoHandler.savedState[type] = Blockly.UndoHandler.createDeletedBlockRecord(data);
            }
            else if (type == Blockly.UndoHandler.STATE_TYPE_MOVED) {
                Blockly.UndoHandler.savedState[type] = Blockly.UndoHandler.createMovedBlockRecord();
            }
            else if (type == Blockly.UndoHandler.STATE_TYPE_CONNECTED) {
                Blockly.UndoHandler.savedState[type] = Blockly.UndoHandler.createConnectedBlockRecord(data);
            }
            else if (type == Blockly.UndoHandler.STATE_TYPE_DISCONNECTED) {
                Blockly.UndoHandler.savedState[type] = Blockly.UndoHandler.createDisconnectedBlockRecord(data);
            }
            else if (type == Blockly.UndoHandler.STATE_TYPE_CREATED) {
                Blockly.UndoHandler.savedState[type] = true;
            }
        }
    }
};

Blockly.UndoHandler.endRecord = function () {
    if(Blockly.UndoHandler.isRecording) {
        // end record and save it, only if there were actual state changes (check by seeing if there are properties other than BLOCK) 
        if (Object.keys(Blockly.UndoHandler.savedState).length > 1) {
            // skip cases where created block was deleted right away
            if(!(Blockly.UndoHandler.savedState[Blockly.UndoHandler.STATE_TYPE_CREATED] && Blockly.UndoHandler.savedState[Blockly.UndoHandler.STATE_TYPE_DELETED])) {
                // if already saving maximum number of states, delete oldest one which is the element at index 0
                if (Blockly.UndoHandler.savedStates.length >= Blockly.UndoHandler.MAX_NUM_SAVED_STATES) {
                    Blockly.UndoHandler.savedStates.shift();
                }
                Blockly.UndoHandler.savedStates.push(Blockly.UndoHandler.savedState);
                // notify state change to undoIndicator
                Blockly.UndoHandler.notifyStateChange();
            }
        }
        Blockly.UndoHandler.isRecording = false;
    }
};
