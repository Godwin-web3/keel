// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title KeelSeal
/// @notice Commit-reveal escrow for DreamDEX Event Contracts.
///         Locks collateral with a hash of (market, side, amount, salt, owner).
///         The book cannot see Up or Down until the owner reveals, then the
///         app places the real Event Contract order. Miss the deadline → refund.
contract KeelSeal {
    struct Ticket {
        address owner;
        bytes32 commitment;
        bytes32 marketId;
        uint256 amount;
        uint64 revealBy;
        bool revealed;
        bool refunded;
        uint8 side; // 0 none, 1 Up, 2 Down
    }

    address public immutable collateral;
    uint256 public nextId = 1;
    mapping(uint256 => Ticket) public tickets;

    event Sealed(uint256 indexed id, address indexed owner, bytes32 marketId, uint256 amount, uint64 revealBy);
    event Revealed(uint256 indexed id, address indexed owner, bytes32 marketId, uint8 side, uint256 amount);
    event Refunded(uint256 indexed id, address indexed owner, uint256 amount);

    error BadAmount();
    error BadDeadline();
    error BadInput();
    error NotOwner();
    error Spent();
    error TooLate();
    error TooEarly();
    error BadSide();
    error BadCommit();
    error TransferFailed();

    constructor(address collateral_) {
        if (collateral_ == address(0)) revert BadInput();
        collateral = collateral_;
    }

    function commit(bytes32 commitment, bytes32 marketId, uint256 amount, uint64 revealBy)
        external
        returns (uint256 id)
    {
        if (amount == 0) revert BadAmount();
        if (revealBy <= block.timestamp) revert BadDeadline();
        if (commitment == bytes32(0) || marketId == bytes32(0)) revert BadInput();
        _pull(msg.sender, amount);
        id = nextId++;
        tickets[id] = Ticket(msg.sender, commitment, marketId, amount, revealBy, false, false, 0);
        emit Sealed(id, msg.sender, marketId, amount, revealBy);
    }

    function reveal(uint256 id, uint8 side, bytes32 salt) external {
        Ticket storage t = tickets[id];
        if (t.owner != msg.sender) revert NotOwner();
        if (t.revealed || t.refunded) revert Spent();
        if (block.timestamp > t.revealBy) revert TooLate();
        if (side != 1 && side != 2) revert BadSide();
        bytes32 expected = keccak256(abi.encode(t.marketId, side, t.amount, salt, msg.sender));
        if (expected != t.commitment) revert BadCommit();
        t.revealed = true;
        t.side = side;
        _push(msg.sender, t.amount);
        emit Revealed(id, msg.sender, t.marketId, side, t.amount);
    }

    function refund(uint256 id) external {
        Ticket storage t = tickets[id];
        if (t.owner != msg.sender) revert NotOwner();
        if (t.revealed || t.refunded) revert Spent();
        if (block.timestamp <= t.revealBy) revert TooEarly();
        t.refunded = true;
        _push(msg.sender, t.amount);
        emit Refunded(id, msg.sender, t.amount);
    }

    function _pull(address from, uint256 amount) internal {
        (bool ok, bytes memory data) = collateral.call(
            abi.encodeWithSelector(0x23b872dd, from, address(this), amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _push(address to, uint256 amount) internal {
        (bool ok, bytes memory data) = collateral.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
