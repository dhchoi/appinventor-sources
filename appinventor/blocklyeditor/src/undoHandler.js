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
 *  - recover from automatic block movements when superior block connects to inferior block
 *  - take care of private members
 *  - implement redo
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
        Blockly.UndoHandler.processState(mostRecentState);
    }
};

Blockly.UndoHandler.processState = function(state) {
    // STATE CHANGE TYPE: deleted -> revive what was deleted
    if(state.hasOwnProperty(Blockly.UndoHandler.STATE_TYPE_DELETED)) {
        var deletedXmlBlock = state[Blockly.UndoHandler.STATE_TYPE_DELETED].xmlBlock;
        Blockly.mainWorkspace.paste(deletedXmlBlock);
        state.BLOCK = Blockly.selected;

        // remap ids since they've changed if deleted and revived back
        var deletedBlocks = state[Blockly.UndoHandler.STATE_TYPE_DELETED].deletedBlocks;
        var revivedBlocks = Blockly.UndoHandler.getDescendantsInFixedOrder(state.BLOCK);
        for(var i = 0; i < deletedBlocks.length; i++) {
            Blockly.UndoHandler.remapDeletedBlockToRevivedBlock(deletedBlocks[i], revivedBlocks[i]);
        }
    }

    // STATE CHANGE TYPE: connected -> disconnect what was connected
    if(state.hasOwnProperty(Blockly.UndoHandler.STATE_TYPE_CONNECTED)) {
        var connectedConnectionIndices = state[Blockly.UndoHandler.STATE_TYPE_CONNECTED];
        for(var i = 0; i < connectedConnectionIndices.length; i++) {
            var connection = state.BLOCK.getConnections_()[connectedConnectionIndices[i]];
            if(connection.targetConnection != null) {
                if (connection.isSuperior()) {
                    connection.targetConnection.sourceBlock_.unplug();
                }
                else {
                    connection.sourceBlock_.unplug();
                }
            }
            else {
                // might be null if failed to reconnect during previous state retrieval
                // case: [1] and [2] were connected vertically, and [3] was connected in middle.
                //       this makes [3] have connection records to [1] and [2].
                //       however, if [2] is deleted and revived, [1] and [2] are already reconnected due to healing,
                //       so undoing the disconnection while reviving [3] couldn't get finished.
                //       since [3]'s connection to [1] and [2] were lost, it can't disconnect from them
                console.log("Blockly.UndoHandler.processState: couldn't undo connection since connection was already lost");
            }
        }
    }

    // STATE CHANGE TYPE: moved -> move back to last position
    if(state.hasOwnProperty(Blockly.UndoHandler.STATE_TYPE_MOVED)) {
        var lastPosition = state[Blockly.UndoHandler.STATE_TYPE_MOVED];
        state.BLOCK.moveTo(lastPosition.x, lastPosition.y);
    }

    // STATE CHANGE TYPE: disconnected -> connect what was disconnected
    if(state.hasOwnProperty(Blockly.UndoHandler.STATE_TYPE_DISCONNECTED)) {
        var disconnectedBlocksRecords = state[Blockly.UndoHandler.STATE_TYPE_DISCONNECTED];
        for(var i = 0; i < disconnectedBlocksRecords.length; i++) {
            var disconnectedBlockRecord = disconnectedBlocksRecords[i];
            var disconnectedBlock = disconnectedBlockRecord.disconnectedBlock;
            var disconnectedBlocksConnectionToBlockIndex = disconnectedBlockRecord.disconnectedBlocksConnectionToBlockIndex;
            var blocksConnectionToDisconnectedBlockIndex = disconnectedBlockRecord.blocksConnectionToDisconnectedBlockIndex;
            // only connect if disconnectedBlock didn't connect to something in the meanwhile (e.g. healStack) 
            if(disconnectedBlock.getConnections_()[disconnectedBlocksConnectionToBlockIndex].targetConnection == null) {
                disconnectedBlock.getConnections_()[disconnectedBlocksConnectionToBlockIndex].connect(state.BLOCK.getConnections_()[blocksConnectionToDisconnectedBlockIndex]);
            }
            else {
                // might be case where targetBlock was already connected to something else (such as connection healing) 
                console.log("Blockly.UndoHandler.processState: couldn't undo disconnection since connection was already lost");
            }
        }
    }

    // STATE CHANGE TYPE: created -> dispose what was created
    if(state.hasOwnProperty(Blockly.UndoHandler.STATE_TYPE_CREATED)) {
        state.BLOCK.dispose(false, false);
    }

    // notify state change to undoIndicator
    Blockly.UndoHandler.notifyStateChange();
};

Blockly.UndoHandler.clearSavedStates = function () {
    Blockly.UndoHandler.savedStates.length = 0;
    Blockly.mainWorkspace.undoIndicator.updateUndoIndicator(Blockly.UndoHandler.savedStates.length);
};

Blockly.UndoHandler.createDeletedBlockRecord = function(deletionType) {
    var block = Blockly.UndoHandler.savedState.BLOCK;
    var xmlBlock = Blockly.Xml.blockToDom_(block);
    var deletedBlocks = Blockly.UndoHandler.getDescendantsInFixedOrder(block);

    // if deleted by dragging, all other nextBlocks were dragged with it, so no special care needed
    // if deleted by keyboard, nextBlocks aren't deleted, so remove nextBlocks from deletedBlocks
    if(deletionType == Blockly.UndoHandler.DELETED_BY_KEY && block.getNextBlock()) {
        var idsForNextBlockDescendants = Blockly.UndoHandler.getDescendantsInFixedOrder(block.getNextBlock());
        for(var i = 0; i < idsForNextBlockDescendants.length; i ++) {
            if(deletedBlocks.indexOf(idsForNextBlockDescendants[i]) > -1) {
                deletedBlocks.splice(deletedBlocks.indexOf(idsForNextBlockDescendants[i]), 1);
            }
        }
        // delete nextBlocks from the XML representation that is gonna be saved too 
        Blockly.Xml.deleteNext(xmlBlock);
    }

    // set position
    var xy = block.getRelativeToSurfaceXY();
    xmlBlock.setAttribute('x', Blockly.RTL ? -xy.x : xy.x);
    xmlBlock.setAttribute('y', xy.y);

    return {xmlBlock: xmlBlock, deletedBlocks: deletedBlocks};
};

Blockly.UndoHandler.createMovedBlockRecord = function () {
    return {x: Blockly.UndoHandler.savedState.BLOCK.startDragX, y: Blockly.UndoHandler.savedState.BLOCK.startDragY}    
};

Blockly.UndoHandler.createConnectedBlockRecord = function(previousConnectedConnections) {
    var newConnectedConnectionsIndices = []; // check what new connected connections the block has made
    var block = Blockly.UndoHandler.savedState.BLOCK;
    
    var allConnections = block.getConnections_();
    for(var i = 0; i < allConnections.length; i++) {
      if(allConnections[i].targetConnection != null && previousConnectedConnections.indexOf(allConnections[i]) < 0) {
          newConnectedConnectionsIndices.push(i); // save connection index only, since connection will be outdated when block is deleted
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
            disconnectedBlocksConnectionToBlockIndex: Blockly.UndoHandler.getIndexOfConnectionToTargetBlock(disconnectedBlock, block),
            blocksConnectionToDisconnectedBlockIndex: Blockly.UndoHandler.getIndexOfConnectionToTargetBlock(block, disconnectedBlock)
        });
    }
    
    return disconnectedBlocksRecords;
};

Blockly.UndoHandler.startRecord = function(block) {
    // not going to save states for changes in other workspaces (e.g. mutator workspaces, etc.)
    if(block.workspace == Blockly.mainWorkspace && Blockly.UndoHandler.isRecording == false) {
        Blockly.UndoHandler.savedState = {}; // reset savedState
        Blockly.UndoHandler.savedState.BLOCK = block;
        Blockly.UndoHandler.isRecording = true;
    }
    else {
        console.log("Blockly.UndoHandler.startRecord: attempting to start new record without ending existing one.");
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
        if(Object.keys(Blockly.UndoHandler.savedState).length > 1) {
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
        else if(Blockly.UndoHandler.savedState.BLOCK) {
            //console.log("Blockly.UndoHandler.endRecord: discarding empty record for blockId: " + Blockly.UndoHandler.savedState.BLOCK.id);
        }
        Blockly.UndoHandler.isRecording = false;
    }
    else {
        console.log("Blockly.UndoHandler.endRecord: there was no previously started record to end.");
    }
};

Blockly.UndoHandler.remapDeletedBlockToRevivedBlock = function(deletedBlock, revivedBlock) {
    for(var i = 0; i < Blockly.UndoHandler.savedStates.length; i++) {
        var savedState = Blockly.UndoHandler.savedStates[i];
        if(savedState.BLOCK && savedState.BLOCK == deletedBlock) {
            savedState.BLOCK = revivedBlock;
        }
        if(savedState[Blockly.UndoHandler.STATE_TYPE_DISCONNECTED]) {
            var disconnectedBlocksRecords = savedState[Blockly.UndoHandler.STATE_TYPE_DISCONNECTED];
            for(var j = 0; j < disconnectedBlocksRecords.length; j++) {
                if (disconnectedBlocksRecords[j].disconnectedBlock == deletedBlock) {
                    disconnectedBlocksRecords[j].disconnectedBlock = revivedBlock;
                }
            }
        }
    }
};

// created own function, since order of getDescendants() differs depending on block connection order
// this will always return fixed order of a block structure's descendants, regardless of in what order the blocks were connected 
Blockly.UndoHandler.getDescendantsInFixedOrder = function(block) {
    var descendantsInFixedOrder = [block];
    var blocksToTraverse = [block];
    var parentBlock = block.getParent(); // not gonna traverse upwards

    while(blocksToTraverse.length > 0) {
        var nextBlock = blocksToTraverse.pop();
        var nextBlockConnections = nextBlock.getConnections_();
        for(var i = 0; i < nextBlockConnections.length; i++) {
            if(nextBlockConnections[i].targetConnection != null) {
                var targetBlock = nextBlockConnections[i].targetConnection.sourceBlock_;
                if(descendantsInFixedOrder.indexOf(targetBlock) < 0 && targetBlock != parentBlock) {
                    descendantsInFixedOrder.push(targetBlock);
                    blocksToTraverse.push(targetBlock);
                }
            }
        }
    }

    return descendantsInFixedOrder;
};

Blockly.UndoHandler.getIndexOfConnectionToTargetBlock = function(sourceBlock, targetBlock) {
    var sourceBlockConnections = sourceBlock.getConnections_();
    for(var i = 0; i < sourceBlockConnections.length; i++) {
        if(sourceBlockConnections[i].targetConnection && (sourceBlockConnections[i].targetConnection.sourceBlock_ == targetBlock)) {
            return i;
        }
    }
};

Blockly.UndoHandler.notifyStateChange = function () {
    Blockly.mainWorkspace.undoIndicator.updateUndoIndicator(Blockly.UndoHandler.savedStates.length);
};
