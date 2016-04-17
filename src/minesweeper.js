import Immutable, { Map, Record, OrderedMap, List, Range } from 'immutable';
import { EventEmitter } from 'events';
import rref from './rref';

export const BlockRecord = Record({ row: 0, col: 0 });
export const Block = Record({
    type: 'normal',
    mines: 0,
    hidden: true,
    flag: false
});

Map.prototype.initSurrounding = function(record) {
    const block = this.get(record);
    return this.update(
        record,
        b => b.set("mines", block.mines + 1)
    );
};

Map.prototype.revealBlock = function(blockRecord, revealMineCallback) {
    // click on normal hidden block
    if (this.get(blockRecord).type === 'mine') {
        return revealMineCallback();
    }
    else {
        let blocks = this.update(
            blockRecord,
            b => b.set("hidden", false)
        );

        if (!this.get(blockRecord).mines) {
            blockRecord.getSurrounding()
                .filter(record => this.get(record).hidden)
                .forEach(record => {
                    blocks = blocks.revealBlock(record, revealMineCallback);
                });
        }

        return blocks;
    }
};

Map.prototype.expandBlock = function(blockRecord, revealMineCallback) {
    const block = this.get(blockRecord);
    let blocks = this;

    if (block.mines && blockRecord.getSurrounding().filter(record => this.get(record).flag).length === block.mines) {
        blockRecord.getSurrounding()
            .filter(record => this.get(record).hidden && !this.get(record).flag)
            .forEach(record => {
                blocks = blocks.revealBlock(record, revealMineCallback);
            });
    }

    return blocks;
};

Map.prototype.setFlag = function(blockRecord) {
    return this.update(
        blockRecord,
        b => b.set("flag", !b.flag)
    );
};

Map.prototype.checkGame = function() {
    if (this.filter(block => block.type === "normal")
            .every(block => !block.hidden)
    ) {
        return true;
    }

    return false;
};


const randomNumberGenerator = ({
    start = 0,
    end,
    number = 1,
    exclude = []
}) => (
    new Array(number)
        .fill(0)
        .map( (cur, index) => index )
        .reduce( (random, index) => {
            let r = Math.floor(Math.random() * (random.length - index));
            random.push(random[r]);
            random.splice(r, 1);
            return random;
        }, new Array(end - start)
            .fill(0)
            .map( (cur, index) => index )
            .filter(cur => !exclude.includes(cur))
        )
        .slice(-number)
);

const Minesweeper = () => ({
    rows: 9,
    cols: 9,
    mines: 10,
    minesRemaining: 10,
    blocks: Map(),
    status: "reading",
    timePass: 0,
    mode: "regular",
    flagMode: false,
    checkIsSolvable: false,

    _timer: null,
    _eventEmitter: new EventEmitter(),
    on: function(event, callback) {
        return this._eventEmitter.on(event, callback);
    },


    reset: function(rows, cols, mines, flagMode, checkIsSolvable) {
        // reset variables
        this.rows = rows || this.rows;
        this.cols = cols || this.cols;
        this.mines = mines || this.mines;
        this.minesRemaining = this.mines;
        this.blocks = Map();
        this.status = "ready";
        this.timePass = 0;
        this.mode = "regular";
        this.flagMode = flagMode || this.flagMode;
        this.checkIsSolvable = checkIsSolvable || this.checkIsSolvable;
        clearInterval(this._timer);
        this._eventEmitter.emit("statuschanged", this.status);

        let blocks = this.blocks;
        // inject this game's rows and cols.
        BlockRecord.prototype.getSurrounding = function() {
            return [].concat(...[-1, 0, 1].map(i => (
                [-1, 0, 1].map(j => (new BlockRecord({
                    row: this.row + i,
                    col: this.col + j
                })))
            ))).filter( ({row, col}) => (
                row >= 0 && col >= 0 && row < rows && col < cols && !(row === this.row && col === this.col)
            ));
        };

        // reset blocks
        new Array(this.rows).fill(0).map((cur, row) => (
            new Array(this.cols).fill(0).map((cur, col) => {
                blocks = blocks.set(
                    new BlockRecord({ row, col }),
                    new Block()
                );
            })
        ));

        return blocks;
    },

    init: function(rows, cols, mines, flagMode, exclude = []) {
        let blocks = this.reset(rows, cols, mines, flagMode);

        exclude = exclude.map(record => record.row * this.cols + record.col);

        // initialize random mines
        randomNumberGenerator({ end: this.rows * this.cols, number: this.mines, exclude })
            .forEach(index => {
                const blockRecord = new BlockRecord({
                    row: Math.floor(index / this.cols),
                    col: index % this.cols
                });

                blocks = blocks.update(blockRecord, b => b.set("type", 'mine'));

                // initialize numbers of surronding mines.
                blockRecord.getSurrounding()
                    .forEach(record => {
                        blocks = blocks.initSurrounding(record);
                    });
            });

        return blocks;
    },

    revealMine: function() {
        this.status = "lose";
        this._eventEmitter.emit("statuschanged", this.status);

        clearInterval(this._timer);

        let blocks = this.blocks;

        blocks.keySeq()
            .toArray()
            .filter(key => blocks.get(key).type === "mine")
            .forEach(mine => {
                blocks = blocks.update(
                    mine,
                    b => b.set("hidden", false)
                );
            });

        return blocks;
    },
    clickOn: function(blockRecord) {
        let blocks = this.blocks;

        // first click, ensure no mines put in the surrounding of the clicked position.
        if (this.status === "ready") {
            const exclude = blockRecord.getSurrounding().concat([blockRecord]);

            blocks = this.init(this.rows, this.cols, this.mines, this.flagMode, exclude);
            while (this.checkIsSolvable && !this.solveByRref(blocks.revealBlock(blockRecord))) {
                blocks = this.init(this.rows, this.cols, this.mines, this.flagMode, exclude);
            }

            this.status = "playing";
            this.mode = this.flagMode ? "quick" : "regular";
            this._eventEmitter.emit("statuschanged", this.status);
            this._timer = setInterval(() => {
                if (this.status === "playing") {
                    this.timePass += 1;
                    this._eventEmitter.emit("timeupdated", this.timePass);
                }
            }, 1000);
        }

        const block = blocks.get(blockRecord);
        // click on flag
        if (block.flag) {
            // do nothing
        }
        // click on hidden block
        else if (block.hidden) {
            if (block.type === 'mine') {
                blocks = this.revealMine();
            }
            else {
                blocks = blocks.revealBlock(blockRecord, () => this.revealMine());
            }
        }
        // click on number, expand surrounding block
        else if (!block.hidden) {
            blocks = blocks.expandBlock(blockRecord, () => this.revealMine());
        }

        return blocks;
    },

    rightClickOn: function(blockRecord) {
        let blocks = this.blocks;
        const block = blocks.get(blockRecord);

        if (block.hidden) {
            blocks = blocks.setFlag(blockRecord);

            this.minesRemaining += blocks.get(blockRecord).flag ? (this.minesRemaining <= 0 ? 0 : -1) : 1;
        }
        else {
            blocks = blocks.expandBlock(blockRecord, () => this.revealMine());
        }

        return blocks;
    },

    singleClick: function(blockRecord) {
        return new Promise(
            (resolve, reject) => {
                setTimeout(() => {
                    if (this.status !== "win" && this.status !== "lose") {
                        if (this.mode === "regular") {
                            this.blocks = this.clickOn(new BlockRecord(blockRecord));
                            // console.log('resolve');
                            resolve(this);
                        }
                        else if (this.mode === "quick") {
                            this.blocks = this.rightClickOn(new BlockRecord(blockRecord));
                            // console.log('resolve');
                            resolve(this);
                        }

                        this.checkGame();
                    }
                }, 0);
            }
        );
    },
    rightClick: function(blockRecord) {
        return new Promise(
            (resolve, reject) => {
                setTimeout(() => {
                    if (this.status !== "win" && this.status !== "lose") {
                        if (this.mode === "regular") {
                            this.blocks = this.rightClickOn(new BlockRecord(blockRecord));
                            console.log('resolve');
                            resolve(this);
                        }
                        else if (this.mode === "quick") {
                            this.blocks = this.clickOn(new BlockRecord(blockRecord));
                            console.log('resolve');
                            resolve(this);
                        }

                        this.checkGame();
                    }
                }, 0);
            }
        );
    },

    checkGame: function() {
        if (this.blocks.checkGame()) {
            this.status = "win";
            this._eventEmitter.emit("statuschanged", this.status);
            clearInterval(this._timer);
            return true;
        }

        return false;
    },


    testingDelay: function(callback) {
        return new Promise(
            function(resolve, reject) {
                callback();
                setTimeout(() => {
                    resolve();
                }, 1000);
            }
        );
    },

    getEdgeBlockRecord: function(blocks) {
        return blocks.keySeq()
            .toArray()
            .filter(key => blocks.get(key).type === "normal" && blocks.get(key).mines && !blocks.get(key).hidden)
            .filter(record => record.getSurrounding().some(
                r => blocks.get(r).hidden && !blocks.get(r).flag
            ));
    },
    solveByRref: function(blocks) {
        /*
         *  inspired by the great article by @ROBERT MASSAIOLI
         *  https://massaioli.wordpress.com/2013/01/12/solving-minesweeper-with-matricies/
         */
        let changed = false;

        const edges = this.getEdgeBlockRecord(blocks);
        const edgeBlocks = blocks.keySeq().filter(record => blocks.get(record).hidden).toArray();

        const matrix = edges.map(edge => {
            const hiddenBlock = edge.getSurrounding()
                .filter(record => blocks.get(record).hidden && !blocks.get(record).flag);
            return edgeBlocks.map(unknown => (
                hiddenBlock.find(h => Immutable.is(h, unknown)) ? 1 : 0
            )).concat([
                blocks.get(edge).mines - edge.getSurrounding().filter(record => blocks.get(record).hidden && blocks.get(record).flag).length
            ]);
        });

        const remainBlocks = blocks.toKeyedSeq().filter( (block, record) => block.hidden && !block.flag );

        const remainCondition = [
            ...edgeBlocks.map(record =>
                remainBlocks.find( (block, r) => Immutable.is(record, r) ) ? 1 : 0
            ),
            this.mines - blocks.filter(block => block.flag && block.hidden).size
        ];

        const rrefMatrix = rref(matrix.concat([remainCondition]));

        const bounds = rrefMatrix.map(row =>
            row.slice(0, row.size - 1)
                .reduce( (bound, col) => (
                    List([
                        bound.get(0) + (col === 1 ? 1 : 0), // maximum bound
                        bound.get(1) + (col === -1 ? -1 : 0) // minimum bound
                    ])
                ), List([0, 0]))
                .push(row.last()) // concat with the augmented column
        );

        bounds.forEach( (bound, row) => {
            if (bound.get(0) === bound.get(2) || bound.get(1) === bound.get(2)) {
                const boundCondition = bound.get(0) === bound.get(2) ? 1 : -1;
                rrefMatrix.get(row).slice(0, rrefMatrix.get(row).size - 1)
                    .forEach( (col, i) => {
                        if (col === boundCondition) {
                            // console.log('flag', edgeBlocks[i]);
                            blocks = blocks.update(edgeBlocks[i], b => b.set("flag", true));
                            changed = true;
                        }
                        else if (col === -boundCondition) {
                            // console.log('reveal', edgeBlocks[i]);
                            blocks = blocks.revealBlock(edgeBlocks[i]);
                            changed = true;
                        }
                    });
            }
        });

        if (!blocks.checkGame()) {
            if (changed) {
                return this.solver(blocks);
            }
            else {
                // console.log('stop');
                return false;
            }
        }
        else {
            // console.log('done');
            return true;
        }
    },


    solver: function(blocks) {
        const edges = this.getEdgeBlockRecord(blocks);
        let changed = false;

        // set flag to those satisfy the mines number
        edges.forEach(record => {
            const surroundingHidden = record.getSurrounding()
                .filter(r => blocks.get(r).hidden);

            if (blocks.get(record).mines === surroundingHidden.length) {
                surroundingHidden.forEach(r => {
                    blocks = blocks.update(
                        r,
                        b => b.set("flag", true)
                    );
                });
                changed = true;
            }
        });

        // reveal those edge blocks being set flag.
        edges.forEach(record => {
            const surrounding = record.getSurrounding();

            if (surrounding.filter(r => blocks.get(r).hidden && blocks.get(r).flag).length === blocks.get(record).mines) {
                surrounding.filter(r => blocks.get(r).hidden && !blocks.get(r).flag)
                    .forEach(r => {
                        blocks = blocks.revealBlock(r);
                    });
                changed = true;
            }
        });

        if (changed) {
            return this.solver(blocks);
        }
        else {
            if (!blocks.checkGame()) {
                return this.solveByRref(blocks);
            }
            else {
                // console.log('done');
                return true;
            }
        }

    }
});

export default Minesweeper;