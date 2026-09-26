// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract Reputation {
    struct Score { uint256 completedTasks; uint256 ratingSum; uint256 totalEarned; uint256 totalSpent; }
    mapping(address => Score) private scores;
    address public immutable owner;
    address public escrow;
    event CompletionRecorded(address indexed worker, address indexed employer, uint8 rating, uint256 amount);

    constructor() { owner = msg.sender; }

    function setEscrow(address escrow_) external {
        require(msg.sender == owner && escrow == address(0) && escrow_ != address(0), "Not allowed");
        escrow = escrow_;
    }

    function recordCompletion(address worker, address employer, uint8 rating, uint256 amount) external {
        require(msg.sender == escrow, "Escrow only");
        require(rating >= 1 && rating <= 5, "Invalid rating");
        scores[worker].completedTasks++;
        scores[worker].ratingSum += rating;
        scores[worker].totalEarned += amount;
        scores[employer].totalSpent += amount;
        emit CompletionRecorded(worker, employer, rating, amount);
    }

    function getScore(address user) external view returns (Score memory) { return scores[user]; }
}
