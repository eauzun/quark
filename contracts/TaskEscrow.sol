// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SkillBadge} from "./SkillBadge.sol";
import {Reputation} from "./Reputation.sol";

contract TaskEscrow is ReentrancyGuard {
    enum Status { Open, Assigned, Delivered, Approved, Rejected, Refunded }
    struct Task {
        address employer; address worker; bytes32 requiredSkillId;
        uint256 amount; uint256 deadline; uint256 reviewDeadline;
        bytes32 deliveryHash; Status status; uint8 rejections;
    }
    uint256 public constant REVIEW_WINDOW = 3 days;
    uint256 public constant RESUBMIT_WINDOW = 3 days;
    SkillBadge public immutable badges;
    Reputation public immutable reputation;
    uint256 public nextTaskId;
    mapping(uint256 => Task) public tasks;

    event TaskCreated(uint256 indexed taskId, address indexed employer, bytes32 requiredSkillId, uint256 amount, uint256 deadline);
    event WorkerAssigned(uint256 indexed taskId, address indexed worker);
    event DeliverySubmitted(uint256 indexed taskId, bytes32 deliveryHash, uint256 reviewDeadline);
    event TaskApproved(uint256 indexed taskId, address indexed worker, uint8 rating, uint256 amount);
    event TaskRejected(uint256 indexed taskId, string reason, uint8 rejections, uint256 deadline);
    event TaskRefunded(uint256 indexed taskId, address indexed employer, uint256 amount);

    constructor(address badges_, address reputation_) {
        require(badges_ != address(0) && reputation_ != address(0), "Zero dependency");
        badges = SkillBadge(badges_); reputation = Reputation(reputation_);
    }

    function createTask(bytes32 requiredSkillId, uint256 amount, uint256 deadline) external payable returns (uint256 id) {
        require(requiredSkillId != bytes32(0) && amount > 0 && msg.value == amount, "Invalid escrow");
        require(deadline > block.timestamp && deadline <= block.timestamp + 90 days, "Invalid deadline");
        id = nextTaskId++;
        tasks[id] = Task(msg.sender, address(0), requiredSkillId, amount, deadline, 0, bytes32(0), Status.Open, 0);
        emit TaskCreated(id, msg.sender, requiredSkillId, amount, deadline);
    }

    function assignWorker(uint256 taskId, address worker) external {
        Task storage t = tasks[taskId];
        require(msg.sender == t.employer && t.status == Status.Open && block.timestamp <= t.deadline, "Cannot assign");
        require(worker != address(0) && worker != t.employer && badges.hasBadge(worker, t.requiredSkillId), "Badge required");
        t.worker = worker; t.status = Status.Assigned;
        emit WorkerAssigned(taskId, worker);
    }

    function submitDelivery(uint256 taskId, bytes32 deliveryHash) external {
        Task storage t = tasks[taskId];
        require(msg.sender == t.worker && block.timestamp <= t.deadline, "Cannot submit");
        require(t.status == Status.Assigned || (t.status == Status.Rejected && t.rejections == 1), "No submission available");
        require(deliveryHash != bytes32(0), "Empty delivery");
        t.deliveryHash = deliveryHash; t.status = Status.Delivered;
        t.reviewDeadline = block.timestamp + REVIEW_WINDOW;
        emit DeliverySubmitted(taskId, deliveryHash, t.reviewDeadline);
    }

    function approve(uint256 taskId, uint8 rating) external nonReentrant {
        Task storage t = tasks[taskId];
        require(msg.sender == t.employer && t.status == Status.Delivered, "Cannot approve");
        require(rating >= 1 && rating <= 5, "Invalid rating");
        _pay(taskId, t, rating);
    }

    function reject(uint256 taskId, string calldata reason) external {
        Task storage t = tasks[taskId];
        require(msg.sender == t.employer && t.status == Status.Delivered && block.timestamp <= t.reviewDeadline, "Cannot reject");
        require(bytes(reason).length > 0 && bytes(reason).length <= 500, "Reason required");
        t.status = Status.Rejected; t.rejections++;
        t.deadline = block.timestamp + RESUBMIT_WINDOW;
        emit TaskRejected(taskId, reason, t.rejections, t.deadline);
    }

    function claimAfterReview(uint256 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        require(msg.sender == t.worker && t.status == Status.Delivered && block.timestamp > t.reviewDeadline, "Review pending");
        _pay(taskId, t, 3);
    }

    function refund(uint256 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        require(msg.sender == t.employer, "Employer only");
        require(t.status == Status.Open || ((t.status == Status.Assigned || t.status == Status.Rejected) && block.timestamp > t.deadline), "Cannot refund");
        t.status = Status.Refunded;
        (bool success,) = payable(t.employer).call{value: t.amount}("");
        require(success, "Transfer failed");
        emit TaskRefunded(taskId, t.employer, t.amount);
    }

    function _pay(uint256 taskId, Task storage t, uint8 rating) private {
        t.status = Status.Approved;
        reputation.recordCompletion(t.worker, t.employer, rating, t.amount);
        (bool success,) = payable(t.worker).call{value: t.amount}("");
        require(success, "Transfer failed");
        emit TaskApproved(taskId, t.worker, rating, t.amount);
    }
}
