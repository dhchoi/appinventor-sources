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
 *  - change hardcoded strings to MSGs and enums + internationalization
 *  - refactor variable and method names
 *  - implement for disconnections in case of healStack when DELETED_BY_KEY
 *  - fix when connecting into middle (if undo is done, then the bottom should connect back to top)
 *  - recover from automatic block movements when superior block connects to inferior block
 *  - take care of private members
 *  - implement redo
 *  - probably refactor later to change isRecording to Object.keys(Blockly.UndoHandler.currentRecord).length? (performance down?)
 *  - create test cases
 *
 *  [Potential]
 *  - implement for block collapse/disable/add_comment changes (context menu orders)?
 *  - implement for block mutations?
 *  - there is a bug? where deleted blocks still remain in workspace (that is why id is incremented for revived blocks)
 *  - not tested for Blockly.Realtime environments (don't know what that is)
 */

'use strict';

goog.provide('Blockly.UndoHandler');

Blockly.UndoHandler.MAX_NUM_SAVED_RECORDS = 20;

Blockly.UndoHandler.STATE_TYPE_CREATED = "STATE_TYPE_CREATED";
Blockly.UndoHandler.STATE_TYPE_MOVED = "STATE_TYPE_MOVED";
Blockly.UndoHandler.STATE_TYPE_CONNECTED = "STATE_TYPE_CONNECTED";
Blockly.UndoHandler.STATE_TYPE_DISCONNECTED = "STATE_TYPE_DISCONNECTED";
Blockly.UndoHandler.STATE_TYPE_DELETED = "STATE_TYPE_DELETED";

Blockly.UndoHandler.DELETED_BY_KEY = "DELETED_BY_KEY";
Blockly.UndoHandler.DELETED_BY_MOUSE = "DELETED_BY_MOUSE";

Blockly.UndoHandler.CREATED_FROM_OTHER_WORKSPACE = "CREATED_FROM_OTHER_WORKSPACE";
Blockly.UndoHandler.CREATED_FROM_SAME_WORKSPACE = "CREATED_FROM_SAME_WORKSPACE";

Blockly.UndoHandler.currentRecord = {};
Blockly.UndoHandler.savedRecords = [];
Blockly.UndoHandler.isRecording = false;

Blockly.UndoHandler.retrieveRecord = function () {
    if(Blockly.UndoHandler.savedRecords.length > 0) {
        var mostRecentRecord = Blockly.UndoHandler.savedRecords.pop();
        Blockly.UndoHandler.processRecord(mostRecentRecord);
    }
};

Blockly.UndoHandler.processRecord = function(record) {
    // STATE CHANGE TYPE: deleted -> revive what was deleted
    if(record.hasOwnProperty(Blockly.UndoHandler.STATE_TYPE_DELETED)) {
        var deletedXmlBlock = record[Blockly.UndoHandler.STATE_TYPE_DELETED].xmlBlock;
        Blockly.mainWorkspace.paste(deletedXmlBlock);
        record.BLOCK = Blockly.selected;

        // remap ids since they've changed if deleted and revived back
        var deletedBlocks = record[Blockly.UndoHandler.STATE_TYPE_DELETED].deletedBlocks;
        var revivedBlocks = Blockly.UndoHandler.getDescendantsInFixedOrder(record.BLOCK);
        for(var i = 0; i < deletedBlocks.length; i++) {
            Blockly.UndoHandler.remapDeletedBlockToRevivedBlock(deletedBlocks[i], revivedBlocks[i]);
        }
    }

    // STATE CHANGE TYPE: connected -> disconnect what was connected
    if(record.hasOwnProperty(Blockly.UndoHandler.STATE_TYPE_CONNECTED)) {
        var connectedConnectionIndices = record[Blockly.UndoHandler.STATE_TYPE_CONNECTED];
        for(var i = 0; i < connectedConnectionIndices.length; i++) {
            var connection = record.BLOCK.getConnections_()[connectedConnectionIndices[i]];
            if(connection.targetConnection != null) {
                if(connection.isSuperior()) {
                    connection.targetConnection.sourceBlock_.unplug();
                }
                else {
                    connection.sourceBlock_.unplug();
                }
            }
            else {
                // might be null if failed to reconnect during previous record retrieval
                // case: [1] and [2] were connected vertically, and [3] was connected in middle.
                //       this makes [3] have connection states to [1] and [2].
                //       however, if [2] is deleted and revived, [1] and [2] are already reconnected due to healing,
                //       so undoing the disconnection while reviving [3] couldn't get finished.
                //       since [3]'s connection to [1] and [2] were lost, it can't disconnect from them
                console.log("Blockly.UndoHandler.processRecord: couldn't undo connection since connection was already lost");
            }
        }
    }

    // STATE CHANGE TYPE: moved -> move back to last position
    if(record.hasOwnProperty(Blockly.UndoHandler.STATE_TYPE_MOVED)) {
        var lastPosition = record[Blockly.UndoHandler.STATE_TYPE_MOVED];
        record.BLOCK.moveTo(lastPosition.x, lastPosition.y);
    }

    // STATE CHANGE TYPE: disconnected -> connect what was disconnected
    if(record.hasOwnProperty(Blockly.UndoHandler.STATE_TYPE_DISCONNECTED)) {
        var disconnectedBlocksRecords = record[Blockly.UndoHandler.STATE_TYPE_DISCONNECTED];
        for(var i = 0; i < disconnectedBlocksRecords.length; i++) {
            var disconnectedBlockRecord = disconnectedBlocksRecords[i];
            var disconnectedBlock = disconnectedBlockRecord.disconnectedBlock;
            var disconnectedBlocksConnectionToBlockIndex = disconnectedBlockRecord.disconnectedBlocksConnectionToBlockIndex;
            var blocksConnectionToDisconnectedBlockIndex = disconnectedBlockRecord.blocksConnectionToDisconnectedBlockIndex;
            // only connect if disconnectedBlock didn't connect to something in the meanwhile (e.g. healStack) 
            if(disconnectedBlock.getConnections_()[disconnectedBlocksConnectionToBlockIndex].targetConnection == null) {
                disconnectedBlock.getConnections_()[disconnectedBlocksConnectionToBlockIndex].connect(record.BLOCK.getConnections_()[blocksConnectionToDisconnectedBlockIndex]);
            }
            else {
                // might be case where targetBlock was already connected to something else (such as connection healing) 
                console.log("Blockly.UndoHandler.processRecord: couldn't undo disconnection since connection was already lost");
            }
        }
    }

    // STATE CHANGE TYPE: created -> dispose what was created
    if(record.hasOwnProperty(Blockly.UndoHandler.STATE_TYPE_CREATED)) {
        record.BLOCK.dispose(false, false);
    }

    // notify updates
    Blockly.UndoHandler.notifyRecordStackUpdated();
};

Blockly.UndoHandler.clearSavedRecords = function () {
    Blockly.UndoHandler.savedRecords.length = 0;
    Blockly.mainWorkspace.undoIndicator.updateUndoIndicator(Blockly.UndoHandler.savedRecords.length);
};

Blockly.UndoHandler.createDeletedBlockRecord = function(deletionType) {
    var block = Blockly.UndoHandler.currentRecord.BLOCK;
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
    return {x: Blockly.UndoHandler.currentRecord.BLOCK.startDragX, y: Blockly.UndoHandler.currentRecord.BLOCK.startDragY}    
};

Blockly.UndoHandler.createConnectedBlockRecord = function(previousConnectedConnections) {
    var newConnectedConnectionsIndices = []; // check what new connected connections the block has made
    var block = Blockly.UndoHandler.currentRecord.BLOCK;
    
    var allConnections = block.getConnections_();
    for(var i = 0; i < allConnections.length; i++) {
      if(allConnections[i].targetConnection != null && previousConnectedConnections.indexOf(allConnections[i]) < 0) {
          newConnectedConnectionsIndices.push(i); // save connection index only, since connection will be outdated when block is deleted
      }
    }
    
    return newConnectedConnectionsIndices;
};

Blockly.UndoHandler.createDisconnectedBlockRecord = function(disconnectedBlocks) {
    var block = Blockly.UndoHandler.currentRecord.BLOCK;
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
        Blockly.UndoHandler.currentRecord.BLOCK = block;
        Blockly.UndoHandler.isRecording = true;
    }
    else {
        console.log("Blockly.UndoHandler.startRecord: attempting to start new record without ending existing one.");
    }
};

Blockly.UndoHandler.addToRecord = function(type, data) {
    if(Blockly.UndoHandler.isRecording) {
        // only add record if it was not recorded yet (preventing duplicates)
        if(!Blockly.UndoHandler.currentRecord.hasOwnProperty(type)) {
            if(type == Blockly.UndoHandler.STATE_TYPE_DELETED) {
                Blockly.UndoHandler.currentRecord[type] = Blockly.UndoHandler.createDeletedBlockRecord(data);
            }
            else if(type == Blockly.UndoHandler.STATE_TYPE_MOVED) {
                Blockly.UndoHandler.currentRecord[type] = Blockly.UndoHandler.createMovedBlockRecord();
            }
            else if(type == Blockly.UndoHandler.STATE_TYPE_CONNECTED) {
                Blockly.UndoHandler.currentRecord[type] = Blockly.UndoHandler.createConnectedBlockRecord(data);
            }
            else if(type == Blockly.UndoHandler.STATE_TYPE_DISCONNECTED) {
                Blockly.UndoHandler.currentRecord[type] = Blockly.UndoHandler.createDisconnectedBlockRecord(data);
            }
            else if(type == Blockly.UndoHandler.STATE_TYPE_CREATED) {
                Blockly.UndoHandler.currentRecord[type] = data;
            }
        }
    }
};

Blockly.UndoHandler.endRecord = function () {
    if(Blockly.UndoHandler.isRecording) {
        // end record and save it, only if there were actual record changes (check by seeing if there are properties other than BLOCK) 
        if(Object.keys(Blockly.UndoHandler.currentRecord).length > 1) {
            // skip cases where created block was deleted right away
            if(!(Blockly.UndoHandler.currentRecord[Blockly.UndoHandler.STATE_TYPE_CREATED] && Blockly.UndoHandler.currentRecord[Blockly.UndoHandler.STATE_TYPE_DELETED])) {
                // if already saving maximum number of states, delete oldest one which is the element at index 0
                if(Blockly.UndoHandler.savedRecords.length >= Blockly.UndoHandler.MAX_NUM_SAVED_RECORDS) {
                    Blockly.UndoHandler.savedRecords.shift();
                }
                Blockly.UndoHandler.savedRecords.push(Blockly.UndoHandler.currentRecord);
                // notify updates
                Blockly.UndoHandler.notifyRecordStackUpdated();
            }
        }
        else if(Blockly.UndoHandler.currentRecord.BLOCK) {
            //console.log("Blockly.UndoHandler.endRecord: discarding empty record for blockId: " + Blockly.UndoHandler.currentRecord.BLOCK.id);
        }
        Blockly.UndoHandler.currentRecord = {}; // reset currentRecord
        Blockly.UndoHandler.isRecording = false;
    }
    else {
        console.log("Blockly.UndoHandler.endRecord: there was no previously started record to end.");
    }
};

Blockly.UndoHandler.remapDeletedBlockToRevivedBlock = function(deletedBlock, revivedBlock) {
    for(var i = 0; i < Blockly.UndoHandler.savedRecords.length; i++) {
        var record = Blockly.UndoHandler.savedRecords[i];
        if(record.BLOCK && record.BLOCK == deletedBlock) {
            record.BLOCK = revivedBlock;
        }
        if(record[Blockly.UndoHandler.STATE_TYPE_DISCONNECTED]) {
            var disconnectedBlocksRecords = record[Blockly.UndoHandler.STATE_TYPE_DISCONNECTED];
            for(var j = 0; j < disconnectedBlocksRecords.length; j++) {
                if(disconnectedBlocksRecords[j].disconnectedBlock == deletedBlock) {
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

Blockly.UndoHandler.recordStartedFromOtherWorkspace = function () {
    var typeToCheck = Blockly.UndoHandler.STATE_TYPE_CREATED;
    if(Blockly.UndoHandler.isRecording && Blockly.UndoHandler.currentRecord.hasOwnProperty(typeToCheck) && Blockly.UndoHandler.currentRecord[typeToCheck] == Blockly.UndoHandler.CREATED_FROM_OTHER_WORKSPACE) {
        return true;
    }
    
    return false;
};

Blockly.UndoHandler.notifyRecordStackUpdated = function () {
    Blockly.mainWorkspace.undoIndicator.updateUndoIndicator(Blockly.UndoHandler.savedRecords.length);
};
